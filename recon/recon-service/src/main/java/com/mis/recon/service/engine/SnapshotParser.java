package com.mis.recon.service.engine;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.recon.domain.config.ReconCheck;
import com.mis.recon.domain.config.ReconCompareRule;
import com.mis.recon.domain.config.ReconDatasource;
import com.mis.recon.domain.config.ReconMatchRule;
import com.mis.recon.repository.CompareRuleRepository;
import com.mis.recon.repository.DatasourceRepository;
import com.mis.recon.repository.MatchRuleRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 对账配置解析器（T05-spec §4）：从 ReconMatchRule/ReconCompareRule/ReconDatasource 解析运行期语义。
 * <p>与 ConfigSnapshot 同包：产出其内部快照模型（CheckSpec/DsConsume），保持加载入口单一。</p>
 */
@Component
public class SnapshotParser {

    private static final Logger log = LoggerFactory.getLogger(SnapshotParser.class);

    private final MatchRuleRepository matchRuleRepo;
    private final CompareRuleRepository compareRuleRepo;
    private final DatasourceRepository datasourceRepo;
    private final ObjectMapper om;

    public SnapshotParser(MatchRuleRepository matchRuleRepo, CompareRuleRepository compareRuleRepo,
                          DatasourceRepository datasourceRepo, ObjectMapper om) {
        this.matchRuleRepo = matchRuleRepo;
        this.compareRuleRepo = compareRuleRepo;
        this.datasourceRepo = datasourceRepo;
        this.om = om;
    }

    /** check 快照构建；配置不完整返回 null（上层跳过该 check）。 */
    public ConfigSnapshot.CheckSpec buildCheck(ReconCheck check) {
        String scenario = check.getScenarioCode();
        ReconMatchRule matchRule = matchRuleRepo.findByScenarioCodeAndCheckName(scenario, check.getCheckName())
                .orElse(null);
        if (matchRule == null || matchRule.getDatasetsJson() == null || matchRule.getDatasetsJson().isBlank()) {
            log.warn("check {} match_rule 缺失或 datasets 为空，跳过", check.getCheckName());
            return null;
        }
        ConfigSnapshot.CheckSpec spec = new ConfigSnapshot.CheckSpec();
        spec.checkName = check.getCheckName();
        if (check.getRunMode() != null) {
            spec.runMode = check.getRunMode();
        }
        String strategy = matchRule.getStrategy() == null ? "exact_key" : matchRule.getStrategy();
        spec.strategy = strategy;

        Map<String, ConfigSnapshot.DsConsume> consumeByAlias = parseConsume(check.getConsumeJson(), spec);
        if (consumeByAlias.isEmpty()) {
            log.warn("check {} consume_json 为空或不可解析，跳过", check.getCheckName());
            return null;
        }
        List<String> datasets = resolveDatasets(matchRule, consumeByAlias);

        ReconCompareRule compareRule = compareRuleRepo.findByScenarioCodeAndCheckName(scenario, check.getCheckName())
                .orElse(null);

        if ("sum_check".equals(strategy)) {
            // sum_check：单数据源内部勾稽，无匹配键（T05-spec-sum-check §3/§7）
            if (datasets.size() != 1) {
                log.warn("check {} sum_check 参与数据源须恰好 1 个（当前 {}），跳过", check.getCheckName(), datasets.size());
                return null;
            }
            spec.match = null;
            if (compareRule != null) {
                spec.sumRules = parseSumRules(compareRule.getRulesJson());
            }
            buildUnitMap(spec, consumeByAlias);
            return spec;
        }

        if ("custom".equals(strategy)) {
            // custom：自定义匹配（custom-需求规格 §3.2）：匹配逻辑整体交给自定义类，无内置匹配键/归一
            if (datasets.size() != 2) {
                log.warn("check {} custom 参与数据源须恰好 2 个（当前 {}），跳过", check.getCheckName(), datasets.size());
                return null;
            }
            spec.match = new MatchEngine.MatchRuleConfig();
            spec.match.strategy = "custom";
            spec.match.datasets = datasets;
            spec.customClass = resolveCustomClass(matchRule);
            spec.customParams = parseCustomParams(matchRule.getConfigJson());
            if (compareRule != null) {
                spec.compareRules = parseRules(compareRule.getRulesJson());
            }
            buildUnitMap(spec, consumeByAlias);
            return spec;
        }

        if ("custom_check".equals(strategy)) {
            // custom_check：整检查自定义（custom-需求规格 §3.3）：匹配+比较整体交给自定义类，1~N 个数据源，
            // 无匹配键/Tab C（rules_json 空数组，不解析 sumRules/compareRules）
            if (datasets.isEmpty()) {
                log.warn("check {} custom_check 参与数据源须至少 1 个（当前 {}），跳过", check.getCheckName(), datasets.size());
                return null;
            }
            spec.match = null;
            spec.customClass = resolveCustomClass(matchRule);
            spec.customParams = parseCustomParams(matchRule.getConfigJson());
            buildUnitMap(spec, consumeByAlias);
            return spec;
        }

        spec.match = buildMatch(matchRule, consumeByAlias, datasets);
        if (spec.match.datasets.size() != 2) {
            log.warn("check {} 参与匹配数据源须恰好 2 个（当前 {}），跳过", check.getCheckName(),
                    spec.match.datasets.size());
            return null;
        }
        if (compareRule != null) {
            spec.compareRules = parseRules(compareRule.getRulesJson());
        }
        buildUnitMap(spec, consumeByAlias);
        return spec;
    }

    /** consume_json → alias 索引（JSON 顺序保持；含 ds_code 必填） */
    private Map<String, ConfigSnapshot.DsConsume> parseConsume(String consumeJson, ConfigSnapshot.CheckSpec spec) {
        Map<String, ConfigSnapshot.DsConsume> result = new LinkedHashMap<>();
        JsonNode node = parse(consumeJson);
        if (node == null || !node.isObject()) {
            return result;
        }
        Iterator<Map.Entry<String, JsonNode>> it = node.fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> e = it.next();
            String alias = e.getKey();
            JsonNode cfg = e.getValue();
            ConfigSnapshot.DsConsume c = new ConfigSnapshot.DsConsume();
            c.alias = alias;
            c.dsCode = cfg.path("ds_code").asText(null);
            c.mode = cfg.path("mode").asText("incremental");
            c.timeField = cfg.path("time_field").asText(null);
            c.start = cfg.path("start").asText(null);
            c.end = cfg.path("end").asText(null);
            if (c.dsCode == null || c.dsCode.isBlank()) {
                log.warn("consume alias {} 缺 ds_code，跳过该 check 消费条目", alias);
                continue;
            }
            result.put(alias, c);
            spec.consumes.add(c);
            if ("time_window".equals(c.mode)) {
                spec.hasTimeWindow = true;
            }
        }
        return result;
    }

    /** datasets_json（alias 列表）→ ds_code 列表（保留 JSON 顺序） */
    private List<String> resolveDatasets(ReconMatchRule rule,
                                         Map<String, ConfigSnapshot.DsConsume> consumeByAlias) {
        List<String> datasets = new ArrayList<>();
        JsonNode node = parse(rule.getDatasetsJson());
        if (node != null && node.isArray()) {
            for (JsonNode n : node) {
                String alias = n.asText();
                ConfigSnapshot.DsConsume c = consumeByAlias.get(alias);
                if (c != null) {
                    datasets.add(c.dsCode);
                }
            }
        }
        return datasets;
    }

    /** match_rule → MatchRuleConfig（alias → ds_code 视角） */
    private MatchEngine.MatchRuleConfig buildMatch(ReconMatchRule rule,
                                                   Map<String, ConfigSnapshot.DsConsume> consumeByAlias,
                                                   List<String> datasets) {
        MatchEngine.MatchRuleConfig cfg = new MatchEngine.MatchRuleConfig();
        cfg.strategy = rule.getStrategy() == null ? "exact_key" : rule.getStrategy();
        cfg.datasets = datasets;
        if (cfg.datasets.size() < 2) {
            cfg.datasets.clear();   // 让上层判"恰好 2 个"
        }

        // 空键跳过开关：config_json 支持 {"empty_key_skip": true}（全局）或 {"empty_key_skip": ["alias"]}（按数据源）
        JsonNode emptyKeyCfg = parse(rule.getConfigJson());
        if (emptyKeyCfg != null && emptyKeyCfg.isObject()) {
            JsonNode skipNode = emptyKeyCfg.get("empty_key_skip");
            if (skipNode != null && skipNode.isArray()) {
                for (JsonNode alias : skipNode) {
                    String a = alias.asText();
                    for (Map.Entry<String, ConfigSnapshot.DsConsume> e : consumeByAlias.entrySet()) {
                        if (e.getKey().equals(a)) {
                            cfg.emptyKeySkipDs.add(e.getValue().dsCode);
                        }
                    }
                }
            } else if (skipNode != null && skipNode.isBoolean() && skipNode.asBoolean()) {
                cfg.emptyKeySkipDs.addAll(cfg.datasets);
            }
        }

        JsonNode keys = parse(rule.getKeyFieldsJson());
        if (keys != null && keys.isObject()) {
            keys.fields().forEachRemaining(e -> {
                ConfigSnapshot.DsConsume c = consumeByAlias.get(e.getKey());
                if (c != null) {
                    cfg.keyFields.put(c.dsCode, e.getValue().asText());
                }
            });
        } else if (keys != null && keys.isArray() && keys.size() > 0) {
            // 列表 [f] 兼容等价：两侧同名单字段
            String expr = "{" + keys.get(0).asText() + "}";
            cfg.datasets.forEach(ds -> cfg.keyFields.put(ds, expr));
        }

        JsonNode transforms = parse(rule.getFieldTransformJson());
        if (transforms != null && transforms.isArray()) {
            for (JsonNode t : transforms) {
                ConfigSnapshot.DsConsume c = consumeByAlias.get(t.path("dataset").asText());
                String dsCode = c == null ? null : c.dsCode;
                if (dsCode != null) {
                    cfg.transforms.add(new MatchEngine.TransformRule(dsCode, t.path("field").asText(),
                            t.path("type").asText("none"), t.path("pattern").asText(null),
                            t.path("replacement").asText(null)));
                }
            }
        }

        JsonNode multi = parse(rule.getMultiRowJson());
        if (multi != null && multi.isObject()) {
            multi.fields().forEachRemaining(e -> {
                ConfigSnapshot.DsConsume c = consumeByAlias.get(e.getKey());
                if (c != null) {
                    cfg.multiRow.put(c.dsCode, e.getValue().asText("reject"));
                }
            });
        }
        return cfg;
    }

    /** rules_json → RuleConfig 列表 */
    private List<CompareEngine.RuleConfig> parseRules(String rulesJson) {
        List<CompareEngine.RuleConfig> rules = new ArrayList<>();
        JsonNode node = parse(rulesJson);
        if (node == null || !node.isArray()) {
            return rules;
        }
        for (JsonNode r : node) {
            CompareEngine.RuleConfig rc = new CompareEngine.RuleConfig();
            rc.name = r.path("name").asText(null);
            rc.leftField = r.path("left_field").asText(null);
            rc.rightField = r.path("right_field").asText(null);
            rc.compareMode = r.path("compare_mode").asText("equal");
            if ("custom".equals(rc.compareMode)) {
                // 规则级自定义比较（C4，custom-需求规格 §3.5）：行含比较器类名 + 行级参数
                rc.comparatorClass = r.path("comparator_class").asText(null);
                JsonNode cp = r.path("comparator_params");
                if (cp != null && cp.isObject()) {
                    rc.comparatorParams = om.convertValue(cp, new TypeReference<Map<String, Object>>() {
                    });
                }
            }
            JsonNode tol = r.path("tolerance");
            if (tol.isObject()) {
                rc.toleranceType = tol.path("type").asText("null");
                JsonNode tv = tol.path("value");
                if (tv.isNumber() || tv.isTextual() && !tv.asText().isBlank()) {
                    try {
                        rc.toleranceValue = new BigDecimal(tv.asText());
                    } catch (NumberFormatException ignore) {
                        rc.toleranceValue = null;
                    }
                }
            } else if (tol.isNull() || tol.isMissingNode()) {
                rc.toleranceType = "null";
            }
            rc.isAmount = r.path("is_amount").asBoolean(false);
            rc.valueTransform = r.path("value_transform").asText("none");
            rc.zeroUnmatchedSkip = r.path("zero_unmatched_skip").asBoolean(false);
            rc.diffUnit = r.path("diff_unit").asText("none");
            // compare_mode=custom 行走自定义比较器，无 left_field/right_field（§3.5）；内置行走字段
            if ("custom".equals(rc.compareMode) || (rc.leftField != null && rc.rightField != null)) {
                rules.add(rc);
            }
        }
        return rules;
    }

    /** rules_json → SumRuleConfig 列表（sum_check：left_expr/right_expr 形态，T05-spec-sum-check §3） */
    private List<CompareEngine.SumRuleConfig> parseSumRules(String rulesJson) {
        List<CompareEngine.SumRuleConfig> rules = new ArrayList<>();
        JsonNode node = parse(rulesJson);
        if (node == null || !node.isArray()) {
            return rules;
        }
        for (JsonNode r : node) {
            CompareEngine.SumRuleConfig rc = new CompareEngine.SumRuleConfig();
            rc.name = r.path("name").asText(null);
            rc.leftExpr = r.path("left_expr").asText(null);
            rc.rightExpr = r.path("right_expr").asText(null);
            JsonNode tol = r.path("tolerance");
            if (tol.isObject()) {
                rc.toleranceType = tol.path("type").asText("null");
                JsonNode tv = tol.path("value");
                if (tv.isNumber() || tv.isTextual() && !tv.asText().isBlank()) {
                    try {
                        rc.toleranceValue = new BigDecimal(tv.asText());
                    } catch (NumberFormatException ignore) {
                        rc.toleranceValue = null;
                    }
                }
            } else if (tol.isNull() || tol.isMissingNode()) {
                rc.toleranceType = "null";
            }
            rc.isAmount = r.path("is_amount").asBoolean(false);
            if (rc.leftExpr != null && rc.rightExpr != null) {
                rules.add(rc);
            }
        }
        return rules;
    }

    /** amount_fields_json → "alias.field" → unit（is_amount=true 转分用） */
    private void buildUnitMap(ConfigSnapshot.CheckSpec spec, Map<String, ConfigSnapshot.DsConsume> consumeByAlias) {
        for (ConfigSnapshot.DsConsume c : spec.consumes) {
            ReconDatasource ds = datasourceRepo.findByDsCode(c.dsCode).orElse(null);
            if (ds == null) {
                continue;
            }
            JsonNode fields = parse(ds.getAmountFieldsJson());
            if (fields == null || !fields.isObject()) {
                continue;
            }
            fields.fields().forEachRemaining(e -> {
                String unit = e.getValue().path("unit").asText("yuan");
                spec.unitByField.put(c.alias + "." + e.getKey(), unit);
            });
        }
    }

    /** custom 类名解析：优先 custom_class 列；缺省回退 config_json.class（§3.7 落库双写）。 */
    private String resolveCustomClass(ReconMatchRule rule) {
        if (rule.getCustomClass() != null && !rule.getCustomClass().isBlank()) {
            return rule.getCustomClass().trim();
        }
        JsonNode cfg = parse(rule.getConfigJson());
        if (cfg != null && cfg.isObject() && cfg.hasNonNull("class")) {
            return cfg.get("class").asText();
        }
        return null;
    }

    /** config_json → 参数 Map（除 class 外键值原样，§3.7 / C5 参数透传；实现类自解析）。 */
    private Map<String, Object> parseCustomParams(String configJson) {
        JsonNode node = parse(configJson);
        if (node == null || !node.isObject()) {
            return new LinkedHashMap<>();
        }
        ObjectNode cfg = (ObjectNode) node.deepCopy();
        cfg.remove("class");
        return om.convertValue(cfg, new TypeReference<Map<String, Object>>() {
        });
    }

    private JsonNode parse(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return om.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }
}
