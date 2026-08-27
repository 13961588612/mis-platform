package com.mis.recon.custom.example;

import com.mis.recon.custom.CustomMatcher;
import com.mis.recon.domain.runtime.AnomalyRow;
import com.mis.recon.domain.runtime.LedgerRow;
import com.mis.recon.domain.runtime.MatchPair;
import com.mis.recon.domain.runtime.MatchResult;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 内置示例：跨系统业务单号匹配（strategy=custom，CustomMatcher 参考实现）。
 *
 * <h3>适用场景</h3>
 * 两侧台账记录的是同一笔业务但单号体系不同（如内部订单号 vs 外部渠道单号）时，
 * 需要按业务键配对。本示例演示最简直配：按 record_key 精确配对；
 * 真实业务可在实现类注入 DataSource / RestTemplate，先按 id_mapping_table 查询
 * 映射表、把一侧键换算成另一侧键后再配对（左侧角色约定见下）。
 *
 * <h3>参数（config_json 除 class 外键值原样传入）</h3>
 * <ul>
 *   <li>{@code id_mapping_table}（可选，String）：外部映射表名。演示仅记录进诊断上下文
 *       （如 sys_order_id_map）；真实场景用于定位映射表。</li>
 *   <li>{@code fallback}（可选，String）：未命中映射时的兜底说明（诊断展示）。</li>
 * </ul>
 *
 * <h3>示例配置</h3>
 * <pre>{@code
 * {
 *   "class": "com.mis.recon.custom.example.CrossSystemIdMatcher",
 *   "id_mapping_table": "sys_order_id_map",
 *   "fallback": "fuzzy"
 * }
 * }</pre>
 *
 * <h3>运行语义（演示简化）</h3>
 * <ul>
 *   <li>输入：{@code dataset} = ds_code → 行集合（已合流增量∪池∪索引）；两侧角色按数据集 key
 *       字典序取第 1=left、第 2=right（真实实现可按自身规则区分两侧）</li>
 *   <li>按 <b>record_key 精确配对</b> → pairs（leftRows/rightRows/leftSingle/rightSingle），
 *       配对差异复用引擎既有判定链路（VerdictService.apply）</li>
 *   <li>左侧有右侧无 → unmatchedLeft；右侧有左侧无 → unmatchedRight</li>
 *   <li>record_key 为空 → anomalies（reason=empty_key，__nullkey__ 身份，左侧/右侧带方向后缀）</li>
 * </ul>
 * 输出：{@link MatchResult}（pairs / unmatchedLeft / unmatchedRight / anomalies；返回 null 视为全空）。
 *
 * <h3>诊断上下文（§13.2 可选附带 → diff_diagnosis_json 根级 custom_context）</h3>
 * <ul>
 *   <li>{@code matched}：配对行数</li>
 *   <li>{@code unmatchedLeft} / {@code unmatchedRight}：两侧未匹配行数</li>
 *   <li>{@code mapping_table}：配置的映射表名（配置时附带）</li>
 *   <li>{@code fallback}：兜底说明（配置时附带）</li>
 * </ul>
 *
 * <h3>注意事项</h3>
 * <ul>
 *   <li>matchKeyHash 演示用 {@code String.hashCode} 十六进制；真实场景应使用稳定 hash（如 SHA-256）
 *       保证差异身份唯一（identity 由实现类决定）</li>
 *   <li>位于 example 子包，配置须写<b>全限定类名</b>（简名补全仅对契约包生效）</li>
 *   <li>注册为 Spring 组件：优先从容器获取（可注入依赖），容器无则反射无参构造兜底</li>
 * </ul>
 */
@Component
public class CrossSystemIdMatcher implements CustomMatcher {

    @Override
    public MatchResult match(Map<String, List<LedgerRow>> dataset, Map<String, Object> params) {
        List<Map.Entry<String, List<LedgerRow>>> sides = new ArrayList<>(dataset.entrySet());
        sides.sort(Map.Entry.comparingByKey());
        List<LedgerRow> left = sides.isEmpty() ? List.of() : sides.get(0).getValue();
        List<LedgerRow> right = sides.size() < 2 ? List.of() : sides.get(1).getValue();
        String table = params == null ? null : params.get("id_mapping_table") == null
                ? null : String.valueOf(params.get("id_mapping_table"));
        String fallback = params == null ? null : params.get("fallback") == null
                ? null : String.valueOf(params.get("fallback"));

        List<MatchPair> pairs = new ArrayList<>();
        List<LedgerRow> unmatchedLeft = new ArrayList<>();
        List<LedgerRow> unmatchedRight = new ArrayList<>();
        List<AnomalyRow> anomalies = new ArrayList<>();

        Map<String, LedgerRow> rightByIdx = new HashMap<>();
        for (LedgerRow r : right) {
            if (blank(r.getRecordKey())) {
                anomalies.add(AnomalyRow.builder()
                        .matchKeyHash("__nullkey__:right:" + r.getDsCode())
                        .matchKeyDisplay("__nullkey__")
                        .rawKey("").reason("empty_key").rightRows(List.of(r)).build());
            } else {
                rightByIdx.putIfAbsent(r.getRecordKey(), r);
            }
        }
        for (LedgerRow l : left) {
            if (blank(l.getRecordKey())) {
                anomalies.add(AnomalyRow.builder()
                        .matchKeyHash("__nullkey__:left:" + l.getDsCode())
                        .matchKeyDisplay("__nullkey__")
                        .rawKey("").reason("empty_key").leftRows(List.of(l)).build());
                continue;
            }
            LedgerRow r = rightByIdx.remove(l.getRecordKey());
            if (r == null) {
                unmatchedLeft.add(l);
            } else {
                pairs.add(MatchPair.builder()
                        .matchKeyHash(Integer.toHexString(l.getRecordKey().hashCode()))
                        .matchKeyDisplay(l.getRecordKey())
                        .rawKey(l.getRecordKey())
                        .leftRows(List.of(l)).rightRows(List.of(r))
                        .leftSingle(l).rightSingle(r)
                        .build());
            }
        }
        unmatchedRight.addAll(rightByIdx.values());

        Map<String, Object> ctx = new HashMap<>();
        ctx.put("matched", pairs.size());
        ctx.put("unmatchedLeft", unmatchedLeft.size());
        ctx.put("unmatchedRight", unmatchedRight.size());
        if (table != null) {
            ctx.put("mapping_table", table);
        }
        if (fallback != null) {
            ctx.put("fallback", fallback);
        }
        return MatchResult.builder()
                .pairs(pairs)
                .unmatchedLeft(unmatchedLeft)
                .unmatchedRight(unmatchedRight)
                .anomalies(anomalies)
                .diagnosisContext(ctx)
                .build();
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
