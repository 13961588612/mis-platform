package com.mis.recon.service.config;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.common.PageResult;
import com.mis.recon.domain.config.ReconCheck;
import com.mis.recon.domain.config.ReconCompareRule;
import com.mis.recon.domain.config.ReconDatasource;
import com.mis.recon.domain.config.ReconMatchRule;
import com.mis.recon.domain.config.ReconScenario;
import com.mis.recon.domain.dto.CheckDetailResp;
import com.mis.recon.domain.dto.CheckSaveReq;
import com.mis.recon.repository.CheckRepository;
import com.mis.recon.repository.CompareRuleRepository;
import com.mis.recon.repository.DatasourceRepository;
import com.mis.recon.repository.MatchRuleRepository;
import com.mis.recon.repository.ScenarioRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 检查配置服务（F80，三表事务）：saveCheck/updateCheck/deleteCheck 同事务写 recon_check +
 * recon_match_rule + recon_compare_rule，并回写场景 uses_json（G12 最小实现：ds+alias，use_fields 空数组）。
 */
@Service
@RequiredArgsConstructor
public class CheckService {

    private final CheckRepository checkRepository;
    private final MatchRuleRepository matchRuleRepository;
    private final CompareRuleRepository compareRuleRepository;
    private final ScenarioRepository scenarioRepository;
    private final DatasourceRepository datasourceRepository;
    private final ConfigValidationService configValidationService;
    private final ObjectMapper objectMapper;

    @Transactional
    public ReconCheck saveCheck(CheckSaveReq req) {
        if (checkRepository.existsByScenarioCodeAndCheckName(req.getScenarioCode(), req.getCheckName())) {
            throw new BizException(ErrorCode.CHECK_NAME_EXISTS);
        }
        configValidationService.validateCheck(req, null,
                checkRepository.findByScenarioCodeOrderBySeqNo(req.getScenarioCode()), dsIndex(req));
        ReconCheck check = toCheck(req);
        checkRepository.save(check);
        ReconMatchRule match = new ReconMatchRule();
        applyMatchRule(match, req);
        matchRuleRepository.save(match);
        if (req.getCompareRule() != null) {
            ReconCompareRule compare = new ReconCompareRule();
            applyCompareRule(compare, req);
            compareRuleRepository.save(compare);
        }
        refreshScenarioUsesJson(req.getScenarioCode());
        return check;
    }

    @Transactional
    public ReconCheck updateCheck(String scenarioCode, String checkName, CheckSaveReq req) {
        ReconCheck existing = checkRepository.findByScenarioCodeAndCheckName(scenarioCode, checkName)
                .orElseThrow(() -> new BizException(ErrorCode.CHECK_NOT_FOUND));
        if (!req.getScenarioCode().equals(scenarioCode) || !req.getCheckName().equals(checkName)) {
            throw new BizException(ErrorCode.CHECK_NAME_FROZEN, "scenario_code/check_name 创建后不可修改");
        }
        configValidationService.validateCheck(req, checkName,
                checkRepository.findByScenarioCodeOrderBySeqNo(scenarioCode), dsIndex(req));
        existing.setSeqNo(req.getSeqNo() == null ? 0 : req.getSeqNo());
        existing.setConsumeJson(rewriteWindow(req));
        existing.setRunMode(StringUtils.hasText(req.getRunMode()) ? req.getRunMode() : "formal");
        existing.setEnabled(Boolean.TRUE.equals(req.getEnabled()) ? 1 : 0);
        checkRepository.save(existing);
        ReconMatchRule match = matchRuleRepository.findByScenarioCodeAndCheckName(scenarioCode, checkName)
                .orElseGet(ReconMatchRule::new);
        applyMatchRule(match, req);
        matchRuleRepository.save(match);
        if (req.getCompareRule() != null) {
            ReconCompareRule compare = compareRuleRepository.findByScenarioCodeAndCheckName(scenarioCode, checkName)
                    .orElseGet(ReconCompareRule::new);
            applyCompareRule(compare, req);
            compareRuleRepository.save(compare);
        } else {
            compareRuleRepository.deleteByScenarioCodeAndCheckName(scenarioCode, checkName);
        }
        refreshScenarioUsesJson(scenarioCode);
        return existing;
    }

    @Transactional
    public void deleteCheck(String scenarioCode, String checkName) {
        ReconCheck check = checkRepository.findByScenarioCodeAndCheckName(scenarioCode, checkName)
                .orElseThrow(() -> new BizException(ErrorCode.CHECK_NOT_FOUND));
        matchRuleRepository.deleteByScenarioCodeAndCheckName(scenarioCode, checkName);
        compareRuleRepository.deleteByScenarioCodeAndCheckName(scenarioCode, checkName);
        checkRepository.delete(check);
        refreshScenarioUsesJson(scenarioCode);
    }

    public PageResult<ReconCheck> page(String scenarioCode, PageRequest pageable, String keyword, Integer enabled) {
        Page<ReconCheck> page = checkRepository.search(scenarioCode, keyword, enabled, pageable);
        return PageResult.from(page);
    }

    public CheckDetailResp get(String scenarioCode, String checkName) {
        ReconCheck check = checkRepository.findByScenarioCodeAndCheckName(scenarioCode, checkName)
                .orElseThrow(() -> new BizException(ErrorCode.CHECK_NOT_FOUND));
        CheckDetailResp resp = new CheckDetailResp();
        resp.setCheck(check);
        resp.setMatchRule(matchRuleRepository.findByScenarioCodeAndCheckName(scenarioCode, checkName).orElse(null));
        resp.setCompareRule(compareRuleRepository.findByScenarioCodeAndCheckName(scenarioCode, checkName).orElse(null));
        return resp;
    }

    // ==================== 转换与回写 ====================

    private ReconCheck toCheck(CheckSaveReq req) {
        ReconCheck c = new ReconCheck();
        c.setScenarioCode(req.getScenarioCode());
        c.setCheckName(req.getCheckName());
        c.setSeqNo(req.getSeqNo() == null ? 0 : req.getSeqNo());
        c.setConsumeJson(rewriteWindow(req));
        c.setRunMode(StringUtils.hasText(req.getRunMode()) ? req.getRunMode() : "formal");
        c.setEnabled(Boolean.TRUE.equals(req.getEnabled()) ? 1 : 0);
        return c;
    }

    private void applyMatchRule(ReconMatchRule m, CheckSaveReq req) {
        m.setScenarioCode(req.getScenarioCode());
        m.setCheckName(req.getCheckName());
        m.setStrategy(req.getMatchRule().getStrategy());
        String datasets = req.getMatchRule().getDatasetsJson();
        m.setDatasetsJson(StringUtils.hasText(datasets) ? datasets : copyConsumeAliases(req.getConsumeJson()));
        // json 列不接受空串（PG invalid input syntax for type json）：统一归一化为 NULL
        m.setKeyFieldsJson(blankToNull(req.getMatchRule().getKeyFieldsJson()));
        m.setFieldTransformJson(blankToNull(req.getMatchRule().getFieldTransformJson()));
        m.setMultiRowJson(blankToNull(req.getMatchRule().getMultiRowJson()));
        m.setCustomClass(req.getMatchRule().getCustomClass());
        m.setConfigJson(blankToNull(req.getMatchRule().getConfigJson()));
    }

    private void applyCompareRule(ReconCompareRule r, CheckSaveReq req) {
        r.setScenarioCode(req.getScenarioCode());
        r.setCheckName(req.getCheckName());
        r.setRulesJson(blankToNull(req.getCompareRule().getRulesJson()));
    }

    /** consume_json 行内回写窗口：time_window 行 start/end 缺省取 check 级汇总窗口（6210 校验之后）。 */
    private String rewriteWindow(CheckSaveReq req) {
        ObjectNode consume = parseConsumeObject(req.getConsumeJson());
        Iterator<Map.Entry<String, JsonNode>> it = consume.fields();
        while (it.hasNext()) {
            JsonNode row = it.next().getValue();
            if (row == null || !row.isObject()) {
                continue;
            }
            if ("time_window".equals(row.path("mode").asText())) {
                ObjectNode r = (ObjectNode) row;
                if (!r.hasNonNull("start") && StringUtils.hasText(req.getWindowStart())) {
                    r.put("start", req.getWindowStart());
                }
                if (!r.hasNonNull("end") && StringUtils.hasText(req.getWindowEnd())) {
                    r.put("end", req.getWindowEnd());
                }
            }
        }
        return writeJson(consume);
    }

    /** datasets_json 为空时第一批自动复制 consume_json 的 alias 列表（收敛口径 2.0：管理端只配一份）。 */
    private String copyConsumeAliases(String consumeJson) {
        ObjectNode consume = parseConsumeObject(consumeJson);
        List<String> aliases = new ArrayList<>();
        consume.fieldNames().forEachRemaining(aliases::add);
        return writeJson(aliases);
    }

    private Map<String, ReconDatasource> dsIndex(CheckSaveReq req) {
        Map<String, ReconDatasource> idx = new HashMap<>();
        ObjectNode consume = parseConsumeObject(req.getConsumeJson());
        Iterator<Map.Entry<String, JsonNode>> it = consume.fields();
        while (it.hasNext()) {
            JsonNode row = it.next().getValue();
            if (row != null && row.isObject() && row.hasNonNull("ds_code")) {
                String dsCode = row.get("ds_code").asText();
                idx.put(dsCode, datasourceRepository.findByDsCode(dsCode).orElse(null));
            }
        }
        return idx;
    }

    /** G12 最小回写：汇总该场景所有 check 的 consume_json -> [{ds, alias, use_fields:[]}]（use_fields 精确并集留 T09）。 */
    private void refreshScenarioUsesJson(String scenarioCode) {
        List<ReconCheck> checks = checkRepository.findByScenarioCodeOrderBySeqNo(scenarioCode);
        Map<String, String> dsAlias = new LinkedHashMap<>();
        for (ReconCheck c : checks) {
            if (!StringUtils.hasText(c.getConsumeJson())) {
                continue;
            }
            JsonNode n = parseJson(c.getConsumeJson());
            if (n == null || !n.isObject()) {
                continue;
            }
            Iterator<Map.Entry<String, JsonNode>> it = n.fields();
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> e = it.next();
                JsonNode row = e.getValue();
                if (row != null && row.isObject() && row.hasNonNull("ds_code")) {
                    dsAlias.putIfAbsent(row.get("ds_code").asText(), e.getKey());
                }
            }
        }
        List<Map<String, Object>> uses = new ArrayList<>();
        for (Map.Entry<String, String> e : dsAlias.entrySet()) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("ds", e.getKey());
            item.put("alias", e.getValue());
            item.put("use_fields", new ArrayList<String>());
            uses.add(item);
        }
        ReconScenario scenario = scenarioRepository.findByScenarioCode(scenarioCode)
                .orElseThrow(() -> new BizException(ErrorCode.SCENARIO_NOT_FOUND));
        scenario.setUsesJson(writeJson(uses));
        scenarioRepository.save(scenario);
    }

    private JsonNode parseJson(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readTree(json);
        } catch (JsonProcessingException e) {
            throw new BizException(ErrorCode.REQUEST_BODY_INVALID, "JSON 格式错误: " + json);
        }
    }

    /** 空串 → NULL（json 列不接受空串，PG 报 invalid input syntax for type json） */
    private String blankToNull(String s) {
        return StringUtils.hasText(s) ? s : null;
    }

    private ObjectNode parseConsumeObject(String consumeJson) {
        JsonNode n = parseJson(consumeJson);
        if (n == null || !n.isObject()) {
            throw new BizException(ErrorCode.REQUEST_BODY_INVALID, "consume_json 必须为 JSON 对象");
        }
        return (ObjectNode) n;
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new BizException(ErrorCode.SYSTEM_ERROR, "JSON 序列化失败");
        }
    }
}
