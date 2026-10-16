package com.mis.recon.service.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.domain.config.ReconCheck;
import com.mis.recon.domain.config.ReconDatasource;
import com.mis.recon.domain.dto.CheckSaveReq;
import com.mis.recon.domain.dto.DatasourceSaveReq;
import com.mis.recon.domain.dto.ScenarioSaveReq;
import com.mis.recon.custom.CustomCheckExecutor;
import com.mis.recon.custom.CustomComparator;
import com.mis.recon.custom.CustomFetcher;
import com.mis.recon.custom.CustomMatcher;
import com.mis.recon.domain.enums.ConfigEnums.ConsumeMode;
import com.mis.recon.domain.enums.ConfigEnums.MatchStrategy;
import com.mis.recon.repository.ConnectionRepository;
import com.mis.recon.repository.DatasourceRepository;
import com.mis.recon.repository.ScenarioRepository;
import com.mis.recon.service.engine.CustomLoader;
import com.mis.recon.service.support.ConnectionPoolManager;
import lombok.RequiredArgsConstructor;
import com.mis.recon.util.WindowExprResolver;
import org.quartz.CronExpression;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 配置保存校验（F81）：V17~V35 中 S 类（保存接口）且 T03 能力可及的子集。
 * V20/V22 作用字段不同不矛盾：V20 管阶段一（增量必须用窗口），V22 管阶段二（聚合禁止用窗口），grain=row 时只有 V20。
 * SQL 串匹配内联实现（T03 不建 util，F21 SqlTextValidator 落地时抽出）。
 */
@Service
@RequiredArgsConstructor
public class ConfigValidationService {

    private static final DateTimeFormatter WINDOW_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    /** 占位符口径与 SqlParamBinder 一致：命名参数 :name / 花括号 {name} */
    private static final Pattern NAMED_PLACEHOLDER = Pattern.compile("(?<![A-Za-z0-9_]):([A-Za-z0-9_]+)");
    private static final Pattern BRACED_PLACEHOLDER = Pattern.compile("\\{([A-Za-z0-9_]+)\\}");

    private final ConnectionRepository connectionRepository;
    private final DatasourceRepository datasourceRepository;
    private final ScenarioRepository scenarioRepository;
    private final CustomLoader customLoader;
    private final ConnectionPoolManager connectionPoolManager;

    // ==================== 唯一性辅助（2001/3001/4001） ====================

    public boolean existsConnCode(String connCode) {
        return connectionRepository.existsByConnCode(connCode);
    }

    public boolean existsDsCode(String dsCode) {
        return datasourceRepository.existsByDsCode(dsCode);
    }

    public boolean existsScenarioCode(String code) {
        return scenarioRepository.existsByScenarioCode(code);
    }

    // ==================== 数据源校验（V20/V22/V34/V35/6208/V33） ====================

    public void validateDatasource(DatasourceSaveReq req) {
        if (!StringUtils.hasText(req.getRecordKeyExpression())) {
            throw new BizException(ErrorCode.RECORD_KEY_BLANK);
        }
        validateCron(req.getPullCron(), "拉取 cron");
        JsonNode cfg = JsonSupport.parse(req.getFetchConfigJson());
        String fetchType = StringUtils.hasText(req.getFetchType()) ? req.getFetchType() : "db";
        switch (fetchType) {
            case "api" -> validateApiFetch(req, cfg);
            case "custom" -> validateCustomFetch(req, cfg);
            default -> {
                // db：SQL 模板（fetch_mode / 占位符 / 聚合 / Union 校验）
                String fetchMode = cfg != null && cfg.hasNonNull("fetch_mode") ? cfg.get("fetch_mode").asText() : null;
                List<String> sqls = fetchSqlCandidates(req);
                validateV20(fetchMode, sqls);
                validatePlaceholders(fetchMode, sqls, cfg);
                validateV22(req.getGrain(), req.getAggSql());
                for (String sql : sqls) {
                    UnionColumnValidator.validate(sql);
                    validateUnionAmountType(req.getConnCode(), sql);
                }
            }
        }
        validateAmountPrimary(JsonSupport.parse(req.getAmountFieldsJson()));
    }

    /** P6 取数层需求规格 §3.8：api fetch_config_json 结构校验。 */
    private void validateApiFetch(DatasourceSaveReq req, JsonNode cfg) {
        requireConnCodeEmpty(req.getConnCode(), "api");
        if (cfg == null || !cfg.hasNonNull("url")) {
            throw new BizException(ErrorCode.FETCH_API_CONFIG_INVALID, "api 取数 url 必填");
        }
        String url = cfg.get("url").asText();
        if (!url.contains("{time_start}") || !url.contains("{time_end}")) {
            throw new BizException(ErrorCode.FETCH_API_CONFIG_INVALID,
                    "api 取数 url 必须包含 {time_start}/{time_end} 窗口占位符（防静默全量拉取）");
        }
        String method = cfg.path("method").asText("GET").toUpperCase();
        if (!"GET".equals(method) && !"POST".equals(method)) {
            throw new BizException(ErrorCode.FETCH_API_CONFIG_INVALID, "api 取数 method 仅支持 GET/POST");
        }
        JsonNode page = cfg.path("page");
        String mode = page.path("mode").asText("cursor");
        if (!"cursor".equals(mode) && !"page_no".equals(mode)) {
            throw new BizException(ErrorCode.FETCH_API_CONFIG_INVALID, "api 取数 page.mode 仅支持 cursor/page_no");
        }
        if ("cursor".equals(mode)) {
            if (!StringUtils.hasText(page.path("cursor_param").asText(null))) {
                throw new BizException(ErrorCode.FETCH_API_CONFIG_INVALID, "cursor 模式必填 page.cursor_param");
            }
            if (!StringUtils.hasText(page.path("cursor_path").asText(null))) {
                throw new BizException(ErrorCode.FETCH_API_CONFIG_INVALID, "cursor 模式必填 page.cursor_path");
            }
        }
        if (page.has("size") && page.path("size").asInt(-1) < 1) {
            throw new BizException(ErrorCode.FETCH_API_CONFIG_INVALID, "api 取数 page.size 必须 ≥ 1");
        }
        String dataPath = cfg.path("data_path").asText(null);
        if (StringUtils.hasText(dataPath) && dataPath.chars().anyMatch(Character::isWhitespace)) {
            throw new BizException(ErrorCode.FETCH_API_CONFIG_INVALID, "api 取数 data_path 非法 JSONPath");
        }
        if (cfg.has("retry") && cfg.path("retry").path("max").asInt(-1) < 0) {
            throw new BizException(ErrorCode.FETCH_API_CONFIG_INVALID, "api 取数 retry.max 必须 ≥ 0");
        }
        if (cfg.has("rate_limit_qps") && cfg.path("rate_limit_qps").asDouble(-1) < 0) {
            throw new BizException(ErrorCode.FETCH_API_CONFIG_INVALID, "api 取数 rate_limit_qps 必须 ≥ 0");
        }
    }

    /** P8 取数层需求规格 §4.6：custom fetch_config_json 结构校验。 */
    private void validateCustomFetch(DatasourceSaveReq req, JsonNode cfg) {
        requireConnCodeEmpty(req.getConnCode(), "custom");
        if (cfg == null || !cfg.hasNonNull("class")) {
            throw new BizException(ErrorCode.CUSTOM_CLASS_BLANK, "自定义拉取实现类 class 必填");
        }
        customLoader.validate(cfg.get("class").asText(), CustomFetcher.class);
        JsonNode configJson = cfg.path("config_json");
        if (!configJson.isMissingNode() && !configJson.isObject()) {
            throw new BizException(ErrorCode.CUSTOM_CONFIG_INVALID, "custom 取数 config_json 须为 JSON 对象");
        }
    }

    /** api/custom 不经过连接层：conn_code 须置空（取数层需求规格 §1）。 */
    private void requireConnCodeEmpty(String connCode, String fetchType) {
        if (StringUtils.hasText(connCode)) {
            throw new BizException(ErrorCode.PARAM_ERROR,
                    fetchType + " 取数不经过连接层，conn_code 须置空");
        }
    }

    /** V38：场景 cron（对账/报告）非空时必须是合法 Quartz cron，前置拦截避免保存成功但调度注册失败。 */
    public void validateScenarioCrons(ScenarioSaveReq req) {
        validateCron(req.getCronExpr(), "对账 cron");
        validateCron(req.getReportCron(), "报告 cron");
    }

    /** V37：cron 非空时必须是合法 Quartz cron（与 SchedulerManager 同口径，前置拦截避免保存成功但调度注册失败）。 */
    private void validateCron(String cron, String label) {
        if (!StringUtils.hasText(cron)) {
            return;
        }
        String expr = cron.trim();
        if (containsNonAscii(expr)) {
            throw new BizException(ErrorCode.CRON_INVALID,
                    label + " 含非半角字符（如 ？），请改用半角 ?");
        }
        if (!CronExpression.isValidExpression(expr)) {
            throw new BizException(ErrorCode.CRON_INVALID,
                    label + " 非法：" + expr + "（Quartz 6/7 段：秒 分 时 日 月 周 [年]，日/周至少一个为 ?）");
        }
    }

    private static boolean containsNonAscii(String s) {
        return s.chars().anyMatch(c -> c > 0x7F);
    }

    private void validateV20(String fetchMode, List<String> sqls) {
        if ("time".equals(fetchMode)) {
            for (String sql : sqls) {
                if (!containsRequiredParams(sql, ":p_start", ":p_end")) {
                    throw new BizException(ErrorCode.V20_WINDOW_PARAM_MISSING,
                            "取数 SQL 必须包含窗口参数 :p_start/:p_end（阶段一增量必须用窗口）");
                }
            }
        } else if ("pk".equals(fetchMode)) {
            for (String sql : sqls) {
                if (!containsRequiredParams(sql, ":p_last_pk")) {
                    throw new BizException(ErrorCode.V20_WINDOW_PARAM_MISSING,
                            "取数 SQL 必须包含窗口参数 :p_last_pk");
                }
            }
        }
    }

    private void validateV22(String grain, String aggSql) {
        if ("aggregated".equals(grain)
                && (containsRequiredParams(aggSql, ":p_start") || containsRequiredParams(aggSql, ":p_end"))) {
            throw new BizException(ErrorCode.V22_AGG_SQL_HAS_WINDOW,
                    "聚合 SQL 禁止包含窗口参数 :p_start/:p_end（聚合阶段禁止使用窗口参数，窗口已由阶段一限定）");
        }
    }

    /** V36（双保险，与前端 validate 同口径）：主取数 SQL 只允许本模式窗口参数；fetch_one_sql 只允许 {record_key}。 */
    private void validatePlaceholders(String fetchMode, List<String> sqls, JsonNode cfg) {
        List<String> allowed = switch (fetchMode == null ? "" : fetchMode) {
            case "time" -> List.of("p_start", "p_end");
            case "pk" -> List.of("p_last_pk");
            default -> List.of();
        };
        for (String sql : sqls) {
            Set<String> bad = placeholderTokens(sql);
            bad.removeAll(allowed);
            if (!bad.isEmpty()) {
                throw new BizException(ErrorCode.SQL_PLACEHOLDER_INVALID,
                        "取数 SQL 只能含窗口参数 :" + String.join("/:", allowed) + "，发现非法占位符 "
                                + formatTokens(bad));
            }
        }
        if (cfg != null && cfg.hasNonNull("fetch_one_sql")) {
            Set<String> bad = placeholderTokens(cfg.get("fetch_one_sql").asText());
            bad.remove("record_key");
            if (!bad.isEmpty()) {
                throw new BizException(ErrorCode.SQL_PLACEHOLDER_INVALID,
                        "fetch_one_sql 只能含 {record_key} 占位符，发现非法占位符 " + formatTokens(bad)
                                + "（record_key 请写 {record_key}）");
            }
        }
    }

    private static Set<String> placeholderTokens(String sql) {
        Set<String> tokens = new HashSet<>();
        if (sql == null || sql.isBlank()) {
            return tokens;
        }
        Matcher m = NAMED_PLACEHOLDER.matcher(sql);
        while (m.find()) {
            tokens.add(m.group(1));
        }
        m = BRACED_PLACEHOLDER.matcher(sql);
        while (m.find()) {
            tokens.add(m.group(1));
        }
        return tokens;
    }

    private static String formatTokens(Set<String> tokens) {
        return tokens.stream().sorted().map(t -> "{" + t + "}").collect(Collectors.joining(", "));
    }

    private List<String> fetchSqlCandidates(DatasourceSaveReq req) {
        List<String> sqls = new ArrayList<>();
        JsonNode cfg = JsonSupport.parse(req.getFetchConfigJson());
        if (cfg != null) {
            if (cfg.hasNonNull("sql")) {
                sqls.add(cfg.get("sql").asText());
            }
            if (cfg.hasNonNull("key_scan_sql")) {
                sqls.add(cfg.get("key_scan_sql").asText());
            }
        }
        if (StringUtils.hasText(req.getKeyScanSql())) {
            sqls.add(req.getKeyScanSql());
        }
        return sqls;
    }

    /** V35：连源库校验 UNION 两侧金额字段类型一致（T04 落地；能力不可及静默放行）。 */
    public void validateUnionAmountType(String connCode, String sql) {
        UnionAmountTypeValidator.validate(connectionPoolManager, connCode, sql);
    }

    /** V33：unit=point/non_monetary 且 role=primary -> 6204。amount_fields_json 结构 {field:{unit,role,...}}。 */
    private void validateAmountPrimary(JsonNode amountFieldsJson) {
        if (amountFieldsJson == null || !amountFieldsJson.isObject()) {
            return;
        }
        Iterator<Map.Entry<String, JsonNode>> it = amountFieldsJson.fields();
        while (it.hasNext()) {
            JsonNode v = it.next().getValue();
            String unit = v.hasNonNull("unit") ? v.get("unit").asText() : null;
            String role = v.hasNonNull("role") ? v.get("role").asText() : null;
            if (("point".equals(unit) || "non_monetary".equals(unit)) && "primary".equals(role)) {
                throw new BizException(ErrorCode.V33_NON_MONETARY_PRIMARY,
                        "积分数/非货币计量字段不能作 primary。primary 必须指向抵扣金额列。若该表只有积分数没有抵扣金额列 → 禁止配 amount primary。");
            }
        }
    }

    // ==================== 检查校验（V21/V33/6207/6209/6210/5002/5003） ====================

    public void validateCheck(CheckSaveReq req, String oldCheckName, List<ReconCheck> existingChecks,
                              Map<String, ReconDatasource> dsByCode) {
        if (oldCheckName != null && !oldCheckName.equals(req.getCheckName())) {
            throw new BizException(ErrorCode.CHECK_NAME_FROZEN, "check_name 创建后不可修改");
        }
        if (req.getMatchRule() == null) {
            throw new BizException(ErrorCode.PARAM_ERROR, "匹配规则 match_rule 必填");
        }
        String strategy = req.getMatchRule().getStrategy();
        MatchStrategy.from(strategy);
        JsonNode rulesJson = req.getCompareRule() == null ? null : JsonSupport.parse(req.getCompareRule().getRulesJson());
        if (req.getCompareRule() != null) {
            validateToleranceInteger(rulesJson);
            validateCustomComparatorRows(rulesJson);
        }
        if ("sum_check".equals(strategy)) {
            // sum_check 专属校验（T05-spec-sum-check §10）：单源 + left_expr/right_expr 必填
            validateSumCheckDatasets(req.getMatchRule().getDatasetsJson());
            validateSumExprs(rulesJson);
        }
        if ("custom".equals(strategy) || "custom_check".equals(strategy)) {
            // custom 专属校验（custom-需求规格 §3.6）：类名必填/可加载/实现接口/config_json 合法/custom 恰好 2 个
            validateCustomStrategy(req.getMatchRule(), strategy);
        }
        ObjectNode consume = JsonSupport.parseObject(req.getConsumeJson());
        Map<String, String> aliasDs = new LinkedHashMap<>();
        Set<String> modes = new HashSet<>();
        Iterator<Map.Entry<String, JsonNode>> it = consume.fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> e = it.next();
            String alias = e.getKey();
            JsonNode row = e.getValue();
            if (row == null || !row.isObject() || !row.hasNonNull("mode")) {
                throw new BizException(ErrorCode.REQUEST_BODY_INVALID, "consume_json 行结构非法: " + alias);
            }
            String mode = row.get("mode").asText();
            ConsumeMode.from(mode);
            modes.add(mode);
            if (row.hasNonNull("ds_code")) {
                aliasDs.put(alias, row.get("ds_code").asText());
            }
        }
        if (modes.size() > 1) {
            throw new BizException(ErrorCode.CONSUME_MODE_MIXED);
        }
        AliasValidator.validate(existingChecks, aliasDs);
        validateTimeFieldAndWindow(req, consume, dsByCode);
        if (dsByCode != null) {
            for (ReconDatasource ds : dsByCode.values()) {
                validateAmountPrimary(JsonSupport.parse(ds.getAmountFieldsJson()));
            }
        }
    }

    private void validateTimeFieldAndWindow(CheckSaveReq req, ObjectNode consume, Map<String, ReconDatasource> dsByCode) {
        Iterator<Map.Entry<String, JsonNode>> it = consume.fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> e = it.next();
            String alias = e.getKey();
            JsonNode row = e.getValue();
            String mode = row.get("mode").asText();
            if (row.hasNonNull("ds_code") && row.hasNonNull("time_field")) {
                String dsCode = row.get("ds_code").asText();
                ReconDatasource ds = dsByCode == null ? null : dsByCode.get(dsCode);
                if (ds != null && !row.get("time_field").asText().equals(ds.getTimeField())) {
                    throw new BizException(ErrorCode.TIME_FIELD_MISMATCH,
                            "consume_json 显式 time_field 与数据源声明不一致: " + alias);
                }
            }
            if ("time_window".equals(mode)) {
                String start = row.hasNonNull("start") ? row.get("start").asText() : req.getWindowStart();
                String end = row.hasNonNull("end") ? row.get("end").asText() : req.getWindowEnd();
                if (!StringUtils.hasText(start) || !StringUtils.hasText(end)) {
                    throw new BizException(ErrorCode.WINDOW_RANGE_INVALID,
                            "存在 time_window 数据源时汇总窗口必填且 end > start: " + alias);
                }
                try {
                    LocalDateTime s = resolveWindowExpr(start);
                    LocalDateTime en = resolveWindowExpr(end);
                    if (s == null || en == null) {
                        throw new BizException(ErrorCode.WINDOW_RANGE_INVALID,
                                "汇总窗口时间须为 yyyy-MM-dd HH:mm:ss 或受支持相对表达式: " + alias);
                    }
                    if (!en.isAfter(s)) {
                        throw new BizException(ErrorCode.WINDOW_RANGE_INVALID, "汇总窗口 end 必须大于 start: " + alias);
                    }
                } catch (DateTimeParseException ex) {
                    throw new BizException(ErrorCode.WINDOW_RANGE_INVALID,
                            "汇总窗口时间格式须为 yyyy-MM-dd HH:mm:ss: " + alias);
                }
            }
        }
    }

    /** 窗口表达式解析：相对表达式按当前时刻换算（校验只验证 end>start），否则绝对时间。 */
    private LocalDateTime resolveWindowExpr(String expr) {
        String e = expr.trim();
        if (WindowExprResolver.isRelative(e)) {
            return WindowExprResolver.resolve(e, LocalDateTime.now());
        }
        return LocalDateTime.parse(e, WINDOW_FMT);
    }

    /** V21：rules_json 每行 tolerance（{type,value} 或裸数值），value 为数值时按整数（单位=分）校验。 */
    private void validateToleranceInteger(JsonNode rules) {
        if (rules == null || !rules.isArray()) {
            return;
        }
        for (JsonNode rule : rules) {
            JsonNode tol = rule.get("tolerance");
            if (tol == null || tol.isNull()) {
                continue;
            }
            if (tol.isNumber()) {
                checkIntegerTolerance(tol.decimalValue());
            } else if (tol.isObject() && tol.hasNonNull("value") && tol.get("value").isNumber()) {
                checkIntegerTolerance(tol.get("value").decimalValue());
            }
        }
    }

    private void checkIntegerTolerance(BigDecimal value) {
        if (value.stripTrailingZeros().scale() > 0) {
            throw new BizException(ErrorCode.V21_TOLERANCE_FRACTION, "金额容差单位=分，必须整数（填小数拒绝）");
        }
    }

    /** V-SC1（T05-spec-sum-check §10）：sum_check 参与数据源（datasets_json）必须恰好 1 个。 */
    private void validateSumCheckDatasets(String datasetsJson) {
        JsonNode node = JsonSupport.parse(datasetsJson);
        int n = 0;
        if (node != null && node.isArray()) {
            n = node.size();
        }
        if (n != 1) {
            throw new BizException(ErrorCode.PARAM_ERROR,
                    "汇总校验 sum_check 需要恰好 1 个参与数据源（当前 " + n + " 个）");
        }
    }

    /** V-SC2（T05-spec-sum-check §10）：sum_check 每条勾稽规则 left_expr/right_expr 必填。 */
    private void validateSumExprs(JsonNode rules) {
        if (rules == null || !rules.isArray()) {
            return;
        }
        int i = 0;
        for (JsonNode rule : rules) {
            i++;
            if (!hasText(rule.get("left_expr")) || !hasText(rule.get("right_expr"))) {
                throw new BizException(ErrorCode.PARAM_ERROR,
                        "sum_check 勾稽规则第 " + i + " 条 left_expr/right_expr 必填");
            }
        }
    }

    /**
     * V 组（custom-需求规格 §3.6）：compare_mode=custom 行 → 比较器类名必填/可加载/实现 CustomComparator；
     * comparator_params 须为合法 JSON 对象（原样透传）。
     */
    private void validateCustomComparatorRows(JsonNode rulesJson) {
        if (rulesJson == null || !rulesJson.isArray()) {
            return;
        }
        int i = 0;
        for (JsonNode r : rulesJson) {
            i++;
            if (!"custom".equals(r.path("compare_mode").asText())) {
                continue;
            }
            String className = r.path("comparator_class").asText(null);
            if (className == null || className.isBlank()) {
                throw new BizException(ErrorCode.CUSTOM_CLASS_BLANK, "第 " + i + " 行：比较器类名必填");
            }
            JsonNode params = r.path("comparator_params");
            if (!params.isMissingNode() && !params.isNull() && !params.isObject()) {
                throw new BizException(ErrorCode.CUSTOM_CONFIG_INVALID,
                        "第 " + i + " 行：参数 JSON 格式错误（comparator_params 须为 JSON 对象）");
            }
            customLoader.validate(className.trim(), CustomComparator.class);
        }
    }

    /**
     * V-C1~V-C4（custom-需求规格 §3.6）：custom/custom_check 保存校验。
     * <ol>
     *   <li>类名必填：custom_class 为空且 config_json.class 为空 → 6214「自定义类名必填」</li>
     *   <li>类可加载：Class.forName 失败 → 6215「类不存在：全限定类名」</li>
     *   <li>实现对应接口：custom → CustomMatcher；custom_check → CustomCheckExecutor → 6216「未实现接口」</li>
     *   <li>config_json 非法 JSON / 非对象 → 6217「参数 JSON 格式错误」</li>
     *   <li>custom 消费清单恰好 2 个（custom_check 1~N 个，不做数量限制）</li>
     * </ol>
     */
    private void validateCustomStrategy(CheckSaveReq.MatchRuleReq matchRule, String strategy) {
        JsonNode cfg = null;
        if (StringUtils.hasText(matchRule.getConfigJson())) {
            try {
                cfg = JsonSupport.parse(matchRule.getConfigJson());
            } catch (BizException e) {
                throw new BizException(ErrorCode.CUSTOM_CONFIG_INVALID, "参数 JSON 格式错误");
            }
            if (cfg != null && !cfg.isObject()) {
                throw new BizException(ErrorCode.CUSTOM_CONFIG_INVALID, "参数 JSON 格式错误（config_json 须为 JSON 对象）");
            }
        }
        String className = StringUtils.hasText(matchRule.getCustomClass())
                ? matchRule.getCustomClass().trim() : null;
        if (className == null && cfg != null && cfg.hasNonNull("class")) {
            className = cfg.get("class").asText();   // §3.7 落库双写兜底
        }
        customLoader.validate(className, "custom_check".equals(strategy) ? CustomCheckExecutor.class : CustomMatcher.class);
        if ("custom".equals(strategy)) {
            validateCustomDatasets(matchRule.getDatasetsJson());
        }
    }

    /** V-C4（custom-需求规格 §3.6）：custom 参与数据源（datasets_json）必须恰好 2 个。 */
    private void validateCustomDatasets(String datasetsJson) {
        JsonNode node = JsonSupport.parse(datasetsJson);
        int n = 0;
        if (node != null && node.isArray()) {
            n = node.size();
        }
        if (n != 2) {
            throw new BizException(ErrorCode.PARAM_ERROR,
                    "自定义匹配 custom 需要恰好 2 个参与数据源（当前 " + n + " 个）");
        }
    }

    private static boolean hasText(JsonNode n) {
        return n != null && !n.isNull() && n.isTextual() && !n.asText().isBlank();
    }

    // ==================== SQL 辅助 ====================

    private static boolean containsRequiredParams(String sql, String... params) {
        if (sql == null || sql.isBlank()) {
            return false;
        }
        for (String p : params) {
            if (!sql.contains(p)) {
                return false;
            }
        }
        return true;
    }
}
