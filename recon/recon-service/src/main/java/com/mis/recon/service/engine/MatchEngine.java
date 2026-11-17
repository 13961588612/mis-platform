package com.mis.recon.service.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.recon.domain.runtime.AnomalyRow;
import com.mis.recon.domain.runtime.LedgerRow;
import com.mis.recon.domain.runtime.MatchPair;
import com.mis.recon.domain.runtime.MatchResult;
import com.mis.recon.util.HashUtil;
import com.mis.recon.util.JsonUtil;
import com.mis.recon.util.KeyExprEvaluator;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 匹配引擎（F91，T05-spec §6）：执行链路=字段值归一 → 拼接匹配键 → 两侧比较。
 * <ul>
 *   <li>key_fields_json 对象形式 {ds: "{expr}"} 权威；列表 [f] 兼容等价（调用方已归一）</li>
 *   <li>field_transform 先归一（transform_chain 记录诊断）；空键 → anomaly（__nullkey__ 兜底身份）</li>
 *   <li>multi_row：aggregate/latest 压行参与比较；reject 转 anomaly（一组一条差异）</li>
 * </ul>
 */
@Component
public class MatchEngine {

    /** 归一规则（field_transform_json 行） */
    public record TransformRule(String dataset, String field, String type, String pattern, String replacement) {
    }

    /** 匹配配置（由 ConfigSnapshot 从 ReconMatchRule 解析） */
    public static class MatchRuleConfig {
        public String strategy;                        // exact_key / composite_key（MVP）
        public List<String> datasets = new ArrayList<>();   // 有序：[left, right]
        public Map<String, String> keyFields = new LinkedHashMap<>();   // {ds: 模板表达式}
        public List<TransformRule> transforms = new ArrayList<>();
        public Map<String, String> multiRow = new LinkedHashMap<>();    // {ds: aggregate/latest/reject}
        public Set<String> emptyKeySkipDs = new HashSet<>();   // 空匹配键直接丢弃（不产 anomaly）的数据集
    }

    private static final String NULL_KEY_PREFIX = "__nullkey__:";

    private final ObjectMapper objectMapper;

    public MatchEngine(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /**
     * 匹配：键现算 → 分组 → 配对 / 单侧缺失 / 异常。
     *
     * @param cfg     匹配规则（datasets 恰好 2 个：第 1=left，第 2=right）
     * @param dataset ds_code → 行集合（已合流：增量 ∪ 池还原 ∪ 索引回查）
     */
    public MatchResult match(MatchRuleConfig cfg, Map<String, List<LedgerRow>> dataset) {
        String leftDs = cfg.datasets.get(0);
        String rightDs = cfg.datasets.get(1);

        List<LedgerRow> leftRows = dataset.getOrDefault(leftDs, List.of());
        List<LedgerRow> rightRows = dataset.getOrDefault(rightDs, List.of());

        Map<String, List<LedgerRow>> leftByKey = new LinkedHashMap<>();
        Map<String, List<LedgerRow>> rightByKey = new LinkedHashMap<>();
        List<AnomalyRow> anomalies = new ArrayList<>();

        for (LedgerRow row : leftRows) {
            computeKey(cfg, leftDs, "left", row, leftByKey, anomalies);
        }
        for (LedgerRow row : rightRows) {
            computeKey(cfg, rightDs, "right", row, rightByKey, anomalies);
        }

        List<MatchPair> pairs = new ArrayList<>();
        List<LedgerRow> unmatchedLeft = new ArrayList<>();
        List<LedgerRow> unmatchedRight = new ArrayList<>();

        List<String> leftKeys = new ArrayList<>(leftByKey.keySet());
        for (String key : leftKeys) {
            List<LedgerRow> leftGroup = leftByKey.get(key);
            List<LedgerRow> rightGroup = rightByKey.remove(key);
            if (rightGroup == null) {
                unmatchedLeft.addAll(leftGroup);
                continue;
            }
            buildPair(cfg, key, leftGroup, rightGroup, pairs, anomalies);
        }
        rightByKey.values().forEach(unmatchedRight::addAll);

        return MatchResult.builder()
                .pairs(pairs)
                .unmatchedLeft(unmatchedLeft)
                .unmatchedRight(unmatchedRight)
                .anomalies(anomalies)
                .build();
    }

    /** 单行键现算并分组；空键直接进 anomalies（empty_key，行级身份） */
    private void computeKey(MatchRuleConfig cfg, String dsCode, String side, LedgerRow row,
                            Map<String, List<LedgerRow>> byKey, List<AnomalyRow> anomalies) {
        String expr = cfg.keyFields.get(dsCode);
        String rawKey;
        if (expr == null || expr.isBlank()) {
            rawKey = "";
        } else {
            rawKey = evaluateTemplate(cfg, dsCode, expr, row);
        }
        if (rawKey == null || rawKey.isEmpty()) {
            // 空键开关：该 ds 配置 empty_key_skip 时直接丢弃（不参与分组、不产 anomaly）
            if (cfg.emptyKeySkipDs.contains(dsCode)) {
                return;
            }
            String display = NULL_KEY_PREFIX + dsCode + ":" + row.getRecordKey();
            anomalies.add(AnomalyRow.builder()
                    .matchKeyHash(HashUtil.sha256Hex(display))
                    .matchKeyDisplay(display)
                    .rawKey("")
                    .reason("empty_key")
                    .leftRows("left".equals(side) ? List.of(row) : List.of())
                    .rightRows("right".equals(side) ? List.of(row) : List.of())
                    .build());
            return;
        }
        byKey.computeIfAbsent(HashUtil.sha256Hex(rawKey), k -> new ArrayList<>()).add(row);
        row.setMatchKeyHash(HashUtil.sha256Hex(rawKey));
        row.setMatchKeyDisplay(rawKey);
    }

    /** 单行匹配键哈希（ReconRunner 预收集增量行 hash 集合做索引回查；空键 → null） */
    public String computeKeyHash(MatchRuleConfig cfg, String dsCode, LedgerRow row) {
        String expr = cfg.keyFields.get(dsCode);
        if (expr == null || expr.isBlank()) {
            return null;
        }
        String rawKey = evaluateTemplate(cfg, dsCode, expr, row);
        if (rawKey == null || rawKey.isEmpty()) {
            return null;
        }
        return HashUtil.sha256Hex(rawKey);
    }

    /** 模板求值：{field} 字段值先按 field_transform 归一，再拼接；归一链记到行（transform_chain 诊断） */
    private String evaluateTemplate(MatchRuleConfig cfg, String dsCode, String expr, LedgerRow row) {
        JsonNode data = row.getRecordData();
        if (data == null || !data.isObject()) {
            return "";
        }
        // 收集模板所需字段值（归一后）
        Map<String, Object> values = new HashMap<>();
        List<String> chain = new ArrayList<>();
        for (String field : KeyExprEvaluator.extractFields(expr)) {
            JsonNode fv = JsonUtil.getFieldIgnoreCase(data, field);
            String raw = fv.isMissingNode() || fv.isNull() ? null : fv.asText();
            String normalized = applyTransform(cfg, dsCode, field, raw, chain);
            values.put(field, normalized);
        }
        row.setTransformChain(chain);
        String key = KeyExprEvaluator.evaluate(expr, values);
        return key == null ? "" : key;
    }

    /** 归一：匹配 (dataset,field) 的规则按类型转换；实际生效时记 transform_chain 条目 */
    private String applyTransform(MatchRuleConfig cfg, String dsCode, String field, String raw,
                                  List<String> chain) {
        if (raw == null) {
            return null;
        }
        for (TransformRule t : cfg.transforms) {
            if (!t.dataset().equals(dsCode) || !t.field().equals(field) || "none".equals(t.type())) {
                continue;
            }
            String before = raw;
            String after = raw;
            switch (t.type()) {
                case "prefix_remove" -> {
                    String prefix = t.pattern() != null ? t.pattern() : t.replacement();
                    if (prefix != null && !prefix.isEmpty() && raw.startsWith(prefix)) {
                        after = raw.substring(prefix.length());
                    }
                }
                case "prefix_add" -> {
                    String prefix = t.pattern() != null ? t.pattern() : t.replacement();
                    if (prefix != null && !prefix.isEmpty()) {
                        after = prefix + raw;
                    }
                }
                case "regex_replace" -> {
                    if (t.pattern() != null) {
                        after = raw.replaceAll(t.pattern(), t.replacement() == null ? "" : t.replacement());
                    }
                }
                default -> {
                }
            }
            if (!after.equals(before)) {
                chain.add("{\"field\":\"" + field + "\",\"rule\":\"" + t.type()
                        + "\",\"before\":\"" + before + "\",\"after\":\"" + after + "\"}");
            }
            return after;
        }
        return raw;
    }

    /** 配对：组内多行按 multi_row 策略处理（reject 转 anomaly；aggregate/latest 压行） */
    private void buildPair(MatchRuleConfig cfg, String keyHash, List<LedgerRow> leftGroup, List<LedgerRow> rightGroup,
                           List<MatchPair> pairs, List<AnomalyRow> anomalies) {
        String leftStrategy = cfg.multiRow.getOrDefault(cfg.datasets.get(0), "reject");
        String rightStrategy = cfg.multiRow.getOrDefault(cfg.datasets.get(1), "reject");

        if (leftGroup.size() > 1 && "reject".equals(leftStrategy)
                || rightGroup.size() > 1 && "reject".equals(rightStrategy)) {
            String display = !leftGroup.isEmpty() && leftGroup.get(0).getRecordData() != null
                    ? keyDisplay(leftGroup.get(0), cfg.datasets.get(0), cfg) : keyHash;
            anomalies.add(AnomalyRow.builder()
                    .matchKeyHash(keyHash)
                    .matchKeyDisplay(display)
                    .rawKey(display)
                    .reason("multi_row_reject")
                    .leftRows(leftGroup)
                    .rightRows(rightGroup)
                    .build());
            return;
        }

        LedgerRow leftSingle = leftGroup.size() == 1 ? leftGroup.get(0) : RowSquasher.squash(leftGroup, leftStrategy, objectMapper);
        LedgerRow rightSingle = rightGroup.size() == 1 ? rightGroup.get(0) : RowSquasher.squash(rightGroup, rightStrategy, objectMapper);
        String display = leftSingle != null ? keyDisplay(leftSingle, cfg.datasets.get(0), cfg) : keyHash;

        List<String> chain = leftSingle != null ? leftSingle.getTransformChain() : null;
        if (chain == null && rightSingle != null) {
            chain = rightSingle.getTransformChain();
        }

        pairs.add(MatchPair.builder()
                .matchKeyHash(keyHash)
                .matchKeyDisplay(display)
                .rawKey(display)
                .transformChain(chain)
                .leftRows(leftGroup)
                .rightRows(rightGroup)
                .leftSingle(leftSingle)
                .rightSingle(rightSingle)
                .multiRowGroupSize(Math.max(leftGroup.size(), rightGroup.size()))
                .build());
    }

    /** 匹配键可读值：优先取 record_data 中匹配键模板字段原始值（展示用） */
    private String keyDisplay(LedgerRow row, String dsCode, MatchRuleConfig cfg) {
        String expr = cfg.keyFields.get(dsCode);
        if (expr == null || row.getRecordData() == null || !row.getRecordData().isObject()) {
            return "";
        }
        JsonNode data = row.getRecordData();
        StringBuilder sb = new StringBuilder();
        for (String field : KeyExprEvaluator.extractFields(expr)) {
            if (sb.length() > 0) {
                sb.append("_");
            }
            JsonNode fv = JsonUtil.getFieldIgnoreCase(data, field);
            sb.append(fv.isMissingNode() || fv.isNull() ? "" : fv.asText());
        }
        return sb.toString();
    }
}
