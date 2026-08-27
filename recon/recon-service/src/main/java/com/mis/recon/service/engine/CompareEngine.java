package com.mis.recon.service.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.mis.recon.custom.CustomComparator;
import com.mis.recon.domain.runtime.CompareResult;
import com.mis.recon.domain.runtime.MatchPair;
import com.mis.recon.domain.runtime.Mismatch;
import com.mis.recon.util.AmountUtil;
import com.mis.recon.util.ExpressionEvaluator;
import com.mis.recon.util.JsonUtil;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 比较引擎（F92，T05-spec §7）：逐规则比较配对行。
 * <ul>
 *   <li>执行链路：value_transform 归一 →（is_amount=true 转分整数域）→ compare_mode 判等 → tolerance 容差</li>
 *   <li>is_amount=true：tolerance 单位=分（long 域）；差值 |left-right| 写入 diffAmountCent（取第一个产生差异的金额字段）</li>
 *   <li>is_amount=false：原值比较（equal=字符串且两侧均为数值时按数值判等；string=严格字符串相等；lte/gte/lt/gt=BigDecimal；contains/regex=字符串）</li>
 *   <li>缺失语义（§8.2）：字段不存在或 JSON null = 缺失 → 记差异；空串 = 空值</li>
 *   <li>compare_mode=custom：该行比较交给自定义比较器（CustomComparator，方案 §13 / custom-需求规格 §3.5），与内置行可混用</li>
 * </ul>
 */
@Component
public class CompareEngine {

    private final CustomLoader customLoader;

    public CompareEngine(CustomLoader customLoader) {
        this.customLoader = customLoader;
    }

    /** 比较规则行（rules_json 解析产物） */
    public static class RuleConfig {
        public String name;
        public String leftField;          // "ds.field"
        public String rightField;         // "ds.field"
        public String compareMode;        // equal/string/lte/gte/lt/gt/contains/regex/custom
        public String toleranceType;      // absolute/percentage/both/null
        public BigDecimal toleranceValue; // absolute/percentage 的数值
        public boolean isAmount;
        public String valueTransform;     // none/trim_comma/trim/uppercase/trim_space/lower/abs（abs=数值取绝对值，按需配置）
        public boolean zeroUnmatchedSkip; // true=单侧 unmatched 且本侧该字段值为 0 时视为一致（不算差异）
        public String diffUnit;           // none/point：point=非货币计量（积分）差额写入 diff_point（V5，不进金钱分 diff_amount_cent）
        public String comparatorClass;          // compare_mode=custom：比较器全限定类名（custom-需求规格 §3.5）
        public Map<String, Object> comparatorParams;   // compare_mode=custom：行级参数（comparator_params，原样存储）
    }

    /** sum_check 勾稽规则行（rules_json 解析产物，T05-spec-sum-check §3/§6） */
    public static class SumRuleConfig {
        public String name;
        public String leftExpr;           // 如 orders.total_amount / orders.a + orders.b
        public String rightExpr;
        public String toleranceType;      // absolute/percentage/both/null（复用既有 tolerance 语义）
        public BigDecimal toleranceValue;
        public boolean isAmount;          // true=分单位容差（is_amount 语义同 RuleConfig）
    }

    /**
     * 逐规则比较。
     *
     * @param rules       比较规则（非空；空规则 = 恒一致）
     * @param pair        匹配对（leftSingle/rightSingle 参与比较）
     * @param unitByField "ds.field" → yuan/point（is_amount=true 转分用；缺失默认 yuan）
     */
    public CompareResult compare(List<RuleConfig> rules, MatchPair pair, Map<String, String> unitByField) {
        if (rules == null || rules.isEmpty()) {
            return CompareResult.ok(0);
        }
        List<Mismatch> mismatches = new ArrayList<>();
        Long diffAmount = null;
        Long diffPoint = null;
        int compared = 0;

        JsonNode leftData = pair.getLeftSingle() == null ? null : pair.getLeftSingle().getRecordData();
        JsonNode rightData = pair.getRightSingle() == null ? null : pair.getRightSingle().getRecordData();

        for (RuleConfig rule : rules) {
            compared++;
            if ("custom".equals(rule.compareMode)) {
                // 规则级自定义比较（C4，custom-需求规格 §3.5）：该行比较整体交给 CustomComparator，与内置行可混用
                CompareResult custom = compareCustom(pair, rule);
                if (!custom.isConsistent()) {
                    mismatches.addAll(custom.getMismatches());
                    if (diffAmount == null) {
                        diffAmount = custom.getDiffAmountCent();
                    }
                    if (diffPoint == null) {
                        diffPoint = custom.getDiffPoint();
                    }
                }
                continue;
            }
            String leftRaw = fieldValue(leftData, rule.leftField);
            String rightRaw = fieldValue(rightData, rule.rightField);
            boolean missing = leftRaw == null || rightRaw == null;

            if (rule.isAmount) {
                Long left = toCent(rule.leftField, normalize(rule.valueTransform, leftRaw), unitByField);
                Long right = toCent(rule.rightField, normalize(rule.valueTransform, rightRaw), unitByField);
                boolean ok = !missing && left != null && right != null
                        && amountMatch(rule, left, right);
                if (!ok) {
                    mismatches.add(new Mismatch(ruleName(rule), display(leftRaw), display(rightRaw),
                            toleranceDesc(rule), missing ? "missing" : rule.compareMode));
                    if (diffAmount == null && left != null && right != null) {
                        diffAmount = Math.abs(left - right);
                    }
                }
            } else {
                boolean ok = !missing && plainMatch(rule, leftRaw, rightRaw);
                if (!ok) {
                    mismatches.add(new Mismatch(ruleName(rule), display(leftRaw), display(rightRaw),
                            toleranceDesc(rule), missing ? "missing" : rule.compareMode));
                    if (diffPoint == null) {
                        diffPoint = pointDiff(rule, leftRaw, rightRaw);
                    }
                }
            }
        }
        CompareResult result = mismatches.isEmpty()
                ? CompareResult.ok(compared)
                : CompareResult.fail(mismatches, diffAmount, compared);
        result.setDiffPoint(diffPoint);
        return result;
    }

    /**
     * 规则级自定义比较（C4，方案 §13）：CustomLoader 加载 CustomComparator → compare(pair) → 一致/差异。
     * <p>比较器未配置类名 → 差异（eqRule=custom，运行时降级可见）；实现返回 null → 视为一致。
     * 行级参数 comparatorParams 由实现类按需自解析（接口边界：compare(pair)，方案 §13.2）。</p>
     */
    private CompareResult compareCustom(MatchPair pair, RuleConfig rule) {
        if (rule.comparatorClass == null || rule.comparatorClass.isBlank()) {
            return CompareResult.fail(List.of(new Mismatch(ruleName(rule), "(未配置比较器)", "", "null", "custom")),
                    null, 1);
        }
        CustomComparator comparator = customLoader.load(rule.comparatorClass, CustomComparator.class);
        Map<String, Object> params = rule.comparatorParams == null ? Map.of() : rule.comparatorParams;
        CompareResult cr = comparator.compare(pair, params);
        return cr == null ? CompareResult.ok(1) : cr;
    }

    /**
     * sum_check 勾稽比较（T05-spec-sum-check §6）：单行比较左右表达式。
     * <p>行字段值 map 键 = alias.field（表达式按 alias.field 引用，如 orders.a + orders.b）；
     * 求值失败（缺失字段/非法表达式）→ 差异（eqRule=missing，与 field_mismatch 可区分）。</p>
     *
     * @param alias   单数据源 alias（表达式前缀）
     * @param rowData 行的 record_data
     * @param rule    勾稽规则
     */
    public CompareResult compareSum(String alias, JsonNode rowData, SumRuleConfig rule) {
        if (rule == null || rule.leftExpr == null || rule.rightExpr == null) {
            return CompareResult.ok(0);
        }
        Map<String, BigDecimal> rowValues = rowValues(alias, rowData);
        BigDecimal left = ExpressionEvaluator.evaluate(rule.leftExpr, rowValues);
        BigDecimal right = ExpressionEvaluator.evaluate(rule.rightExpr, rowValues);
        if (left == null || right == null) {
            return CompareResult.fail(List.of(new Mismatch(sumRuleName(rule),
                    displayBig(left), displayBig(right), toleranceDesc(rule), "missing")), null, 1);
        }
        boolean ok;
        Long diffAmount = null;
        if (rule.isAmount) {
            Long lc = toCent(left);
            Long rc = toCent(right);
            if (lc == null || rc == null) {
                return CompareResult.fail(List.of(new Mismatch(sumRuleName(rule),
                        left.toPlainString(), right.toPlainString(), toleranceDesc(rule), "missing")), null, 1);
            }
            ok = amountMatch(synthetic(rule), lc, rc);
            if (!ok) {
                diffAmount = Math.abs(lc - rc);
            }
        } else {
            ok = plainMatch(synthetic(rule), left.toPlainString(), right.toPlainString());
        }
        if (!ok) {
            return CompareResult.fail(List.of(new Mismatch(sumRuleName(rule),
                    left.toPlainString(), right.toPlainString(), toleranceDesc(rule), "equal")), diffAmount, 1);
        }
        return CompareResult.ok(1);
    }

    /** sum_check 规则 → 临时 RuleConfig（复用 amountMatch/plainMatch 容差逻辑，compareMode=equal） */
    private RuleConfig synthetic(SumRuleConfig rule) {
        RuleConfig rc = new RuleConfig();
        rc.compareMode = "equal";
        rc.toleranceType = rule.toleranceType;
        rc.toleranceValue = rule.toleranceValue;
        return rc;
    }

    /** 行字段值 map：alias.field → BigDecimal（字段缺失/空/非数值 → 不进 map，表达式引用即 MISSING） */
    private Map<String, BigDecimal> rowValues(String alias, JsonNode rowData) {
        Map<String, BigDecimal> values = new HashMap<>();
        if (rowData == null || !rowData.isObject()) {
            return values;
        }
        rowData.fields().forEachRemaining(e -> {
            String v = e.getValue().asText();
            if (v == null || v.isBlank() || !isNumeric(v)) {
                return;
            }
            try {
                values.put(alias + "." + e.getKey(), new BigDecimal(v));
            } catch (NumberFormatException ignore) {
                // 不可解析：不进 map
            }
        });
        return values;
    }

    /** is_amount=true：表达式结果（原始值）→ 整数分（×100 HALF_UP；超 BIGINT 拒绝 → null） */
    private Long toCent(BigDecimal v) {
        if (v == null) {
            return null;
        }
        try {
            return v.multiply(BigDecimal.valueOf(100)).setScale(0, java.math.RoundingMode.HALF_UP).longValueExact();
        } catch (ArithmeticException e) {
            return null;
        }
    }

    private String sumRuleName(SumRuleConfig rule) {
        if (rule.name != null && !rule.name.isBlank()) {
            return rule.name;
        }
        return rule.leftExpr + " = " + rule.rightExpr;
    }

    private String displayBig(BigDecimal v) {
        return v == null ? "(缺失)" : v.toPlainString();
    }

    private String toleranceDesc(SumRuleConfig rule) {
        if ("null".equals(rule.toleranceType)) {
            return "null";
        }
        if (rule.toleranceValue == null) {
            return rule.toleranceType == null ? "null" : rule.toleranceType;
        }
        return rule.toleranceType + ":" + rule.toleranceValue.toPlainString();
    }

    // ---- 行级金额取值（供 VerdictService 复用，非比较路径） ----
    /**
     * 取行金额字段的分值（unmatched 0 值跳过判断用）。
     * <p>复用 compare() 内的"取值 → 归一 → toCent"链；非金额规则或字段缺失/非法 → null。
     * 与 compare() 的差异：仅取单侧值，不要求对端存在（对端缺失正是 unmatched 场景）。
     *
     * @param rule       比较规则（isAmount=true 才有意义）
     * @param recordData 行的 record_data
     * @param side       "left" / "right"（决定取 rule.leftField 还是 rightField）
     * @param unitByField "ds.field" → yuan/point
     */
    public Long extractAmountCent(RuleConfig rule, JsonNode recordData, String side, Map<String, String> unitByField) {
        if (rule == null || !rule.isAmount) {
            return null;
        }
        String dsField = "left".equals(side) ? rule.leftField : rule.rightField;
        String raw = fieldValue(recordData, dsField);
        if (raw == null) {
            return null;
        }
        return toCent(dsField, normalize(rule.valueTransform, raw), unitByField);
    }

    /**
     * 取规则某侧字段归一后的数值；缺失/不可解析 → null。
     * <p>供 VerdictService zero_unmatched_skip 判断：单侧 unmatched 时本侧取值=0 视为一致。</p>
     */
    public BigDecimal extractFieldNumber(RuleConfig rule, JsonNode recordData, String side) {
        if (rule == null || recordData == null) {
            return null;
        }
        String dsField = "left".equals(side) ? rule.leftField : rule.rightField;
        String raw = fieldValue(recordData, dsField);
        if (raw == null) {
            return null;
        }
        String v = normalize(rule.valueTransform, raw);
        if (!isNumeric(v)) {
            return null;
        }
        try {
            return new BigDecimal(v);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    // ---- 金额比较（分域） ----

    private boolean amountMatch(RuleConfig rule, long left, long right) {
        long diff = Math.abs(left - right);
        if ("null".equals(rule.toleranceType)) {
            return diff == 0;
        }
        boolean absolute = !"percentage".equals(rule.toleranceType);   // absolute / both 含绝对差
        boolean percentage = !"absolute".equals(rule.toleranceType);   // percentage / both 含比例
        boolean absOk = !absolute || rule.toleranceValue == null || diff <= rule.toleranceValue.longValue();
        boolean pctOk = true;
        if (percentage && rule.toleranceValue != null) {
            BigDecimal denom = new BigDecimal(left).abs();
            if (denom.compareTo(BigDecimal.ZERO) == 0) {
                pctOk = diff == 0;   // 左侧 0 退化相等（§8.2）
            } else {
                pctOk = new BigDecimal(diff).divide(denom, 6, java.math.RoundingMode.HALF_UP)
                        .compareTo(rule.toleranceValue) <= 0;
            }
        }
        return absOk && pctOk;
    }

    // ---- 非金额比较（原值） ----

    /** 积分差额（V5）：diff_unit=point 规则，归一后 |左-右|（原值整数；非 point 规则/任一侧缺失非法 → null） */
    private Long pointDiff(RuleConfig rule, String leftRaw, String rightRaw) {
        if (rule.diffUnit == null || !"point".equals(rule.diffUnit)
                || leftRaw == null || rightRaw == null) {
            return null;
        }
        String l = normalize(rule.valueTransform, leftRaw);
        String r = normalize(rule.valueTransform, rightRaw);
        if (!isNumeric(l) || !isNumeric(r)) {
            return null;
        }
        try {
            return new BigDecimal(l).subtract(new BigDecimal(r)).abs().longValueExact();
        } catch (ArithmeticException e) {
            return null;
        }
    }

    private boolean plainMatch(RuleConfig rule, String left, String right) {
        String l = normalize(rule.valueTransform, left);
        String r = normalize(rule.valueTransform, right);
        switch (rule.compareMode == null ? "equal" : rule.compareMode) {
            case "equal" -> {
                if (l.equals(r)) {
                    return true;
                }
                boolean numeric = isNumeric(l) && isNumeric(r);
                // 显式容差：数值可解析时按 tolerance 数值比较（非金额字段 tolerance 单位=原值）
                if (numeric && rule.toleranceValue != null) {
                    BigDecimal lb = new BigDecimal(l);
                    BigDecimal rb = new BigDecimal(r);
                    if ("absolute".equals(rule.toleranceType)) {
                        return lb.subtract(rb).abs().compareTo(rule.toleranceValue) <= 0;
                    }
                    if ("percentage".equals(rule.toleranceType)) {
                        BigDecimal denom = lb.abs();
                        if (denom.compareTo(BigDecimal.ZERO) == 0) {
                            return lb.compareTo(rb) == 0;
                        }
                        return lb.subtract(rb).abs().divide(denom, 6, java.math.RoundingMode.HALF_UP)
                                .compareTo(rule.toleranceValue) <= 0;
                    }
                    if ("both".equals(rule.toleranceType)) {
                        BigDecimal absDiff = lb.subtract(rb).abs();
                        boolean absOk = absDiff.compareTo(rule.toleranceValue) <= 0;
                        BigDecimal denom = lb.abs();
                        boolean pctOk = denom.compareTo(BigDecimal.ZERO) == 0
                                ? lb.compareTo(rb) == 0
                                : absDiff.divide(denom, 6, java.math.RoundingMode.HALF_UP).compareTo(rule.toleranceValue) <= 0;
                        return absOk && pctOk;
                    }
                }
                // 默认兜底：无显式容差且字符串不等时，两侧均可解析为数值 → 按数值判等
                // （金额字符串格式差异 458.00 vs 458、176.80 vs 176.8 不再误报；非数值字段仍走字符串比较）
                if (numeric) {
                    return new BigDecimal(l).compareTo(new BigDecimal(r)) == 0;
                }
                return false;
            }
            case "string" -> {
                // 严格字符串相等：不走数值判等兜底（编码类字段 0123 != 123 时用）
                return l.equals(r);
            }
            case "lte" -> {
                return isNumeric(l) && isNumeric(r) && new BigDecimal(l).compareTo(new BigDecimal(r)) <= 0;
            }
            case "gte" -> {
                return isNumeric(l) && isNumeric(r) && new BigDecimal(l).compareTo(new BigDecimal(r)) >= 0;
            }
            case "lt" -> {
                return isNumeric(l) && isNumeric(r) && new BigDecimal(l).compareTo(new BigDecimal(r)) < 0;
            }
            case "gt" -> {
                return isNumeric(l) && isNumeric(r) && new BigDecimal(l).compareTo(new BigDecimal(r)) > 0;
            }
            case "contains" -> {
                return l.contains(r);
            }
            case "regex" -> {
                try {
                    return Pattern.compile(r).matcher(l).matches();
                } catch (Exception e) {
                    return false;
                }
            }
            default -> {
                return false;
            }
        }
    }

    // ---- 取值 / 归一 / 转分 ----

    /** 从 record_data 取 "ds.field" 值；字段缺失或 JSON null → null（缺失语义） */
    private String fieldValue(JsonNode data, String dsField) {
        if (data == null || dsField == null) {
            return null;
        }
        int dot = dsField.indexOf('.');
        String field = dot < 0 ? dsField : dsField.substring(dot + 1);
        JsonNode node = JsonUtil.getFieldIgnoreCase(data, field);
        if (node == null || node.isMissingNode() || node.isNull()) {
            return null;
        }
        String v = node.asText();
        return v == null ? null : v;
    }

    private String normalize(String transform, String value) {
        if (value == null) {
            return null;
        }
        String v = value;
        switch (transform == null ? "none" : transform) {
            case "trim_comma" -> v = v.replace(",", "");
            case "trim" -> v = v.trim();
            case "trim_space" -> v = v.trim();
            case "uppercase" -> v = v.toUpperCase();
            case "lower" -> v = v.toLowerCase();
            case "abs" -> {
                // 数值取绝对值（含 "-3000" → "3000"）：有的对账需按扣减绝对值比较，规则级开关
                if (isNumeric(v)) {
                    v = new BigDecimal(v).abs().stripTrailingZeros().toPlainString();
                }
            }
            default -> {
            }
        }
        return v;
    }

    /** is_amount=true：值 → 整数分（unit 缺失默认 yuan） */
    private Long toCent(String dsField, String raw, Map<String, String> unitByField) {
        if (raw == null) {
            return null;
        }
        String unit = unitByField == null ? null : unitByField.get(dsField);
        if (unit == null) {
            unit = "yuan";
        }
        Long cent = AmountUtil.toCent(raw, unit, "as_is");
        if (cent == null && isNumeric(raw)) {
            // AmountUtil 对 non_monetary/point 语义：unit=point 原值即分；兜底按元
            try {
                return new BigDecimal(raw).movePointRight(2).longValueExact();
            } catch (Exception e) {
                return null;
            }
        }
        return cent;
    }

    private boolean isNumeric(String v) {
        if (v == null || v.isBlank()) {
            return false;
        }
        try {
            new BigDecimal(v);
            return true;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    private String ruleName(RuleConfig rule) {
        if (rule.name != null && !rule.name.isBlank()) {
            return rule.name;
        }
        return (rule.leftField == null ? "?" : rule.leftField) + " vs "
                + (rule.rightField == null ? "?" : rule.rightField);
    }

    private String display(String v) {
        return v == null ? "(缺失)" : v;
    }

    private String toleranceDesc(RuleConfig rule) {
        if ("null".equals(rule.toleranceType)) {
            return "null";
        }
        if (rule.toleranceValue == null) {
            return rule.toleranceType == null ? "null" : rule.toleranceType;
        }
        return rule.toleranceType + ":" + rule.toleranceValue.toPlainString();
    }
}
