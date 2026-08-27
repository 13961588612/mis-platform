package com.mis.recon.custom.example;

import com.fasterxml.jackson.databind.JsonNode;
import com.mis.recon.custom.CustomComparator;
import com.mis.recon.domain.runtime.CompareResult;
import com.mis.recon.domain.runtime.LedgerRow;
import com.mis.recon.domain.runtime.MatchPair;
import com.mis.recon.domain.runtime.Mismatch;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Map;

/**
 * 内置示例：阶梯定价金额容差比较（compare_mode=custom，CustomComparator 参考实现）。
 *
 * <h3>适用场景</h3>
 * 同一规则下不同金额区间的容差不同（如小额严、大额松的阶梯定价场景）。
 * 本示例演示规则级自定义比较：Tab C 某规则行 compare_mode=custom 时，该行差异
 * 交给本比较器（与内置 equal 行可混用），按左侧金额所在区间取容差判定。
 *
 * <h3>参数（行级 comparator_params 原样传入；不含 class 键，比较器类名独立 comparator_class 字段）</h3>
 * <ul>
 *   <li>{@code amount_field}（必填，String，默认 pay_amount）：金额字段名，从两侧 record_data 取值。</li>
 *   <li>{@code tiers}（可选，数组）：阶梯容差表 {@code [{min,max,tolerance}]}，tolerance 为该区间允许的
 *       <b>金额绝对差（元）</b>；未命中任何区间 → 精确相等（容差 0）。</li>
 *   <li>{@code round}（可选，int，默认 2）：比较前金额保留小数位（HALF_UP）。</li>
 * </ul>
 *
 * <h3>示例配置（rules_json 行内 comparator_params）</h3>
 * <pre>{@code
 * {
 *   "tiers": [
 *     { "min": 0, "max": 100, "tolerance": 0.5 },
 *     { "min": 100, "max": 500, "tolerance": 2 }
 *   ],
 *   "amount_field": "pay_amount",
 *   "round": 2
 * }
 * }</pre>
 *
 * <h3>运行语义（演示简化）</h3>
 * <ul>
 *   <li>输入：{@link MatchPair}（leftSingle/rightSingle）+ 行级参数；两侧 record_data 取 amount_field</li>
 *   <li>两侧金额缺失 → 差异（tolerance=missing，diffAmountCent=null）</li>
 *   <li>按<b>左侧金额</b>命中区间取容差：|left-right|（round 后）≤ tolerance → 一致；否则差异</li>
 *   <li>差异：Mismatch(field=amount_field、left/rightValue=原始值、tolerance=区间容差、eqRule=custom)
 *       + diffAmountCent=|差值|×100（分）；未命中区间 → 精确相等</li>
 * </ul>
 * 输出：{@link CompareResult}（ok / fail）；返回 null 由引擎视为一致（降级兜底）。
 *
 * <h3>注意事项</h3>
 * <ul>
 *   <li>tolerance 单位为"元"，diffAmountCent 为"分"（差值×100，四舍五入）</li>
 *   <li>tiers 区间为左闭右开 [min, max)；min/max/tolerance 支持数字或数字字符串</li>
 *   <li>位于 example 子包，配置须写<b>全限定类名</b>（简名补全仅对契约包生效）</li>
 *   <li>注册为 Spring 组件：优先从容器获取（可注入依赖），容器无则反射无参构造兜底</li>
 * </ul>
 */
@Component
public class TieredPricingComparator implements CustomComparator {

    private static final BigDecimal ZERO = BigDecimal.ZERO;

    @Override
    public CompareResult compare(MatchPair pair, Map<String, Object> params) {
        String field = params == null || params.get("amount_field") == null
                ? "pay_amount" : String.valueOf(params.get("amount_field"));
        int round = params == null || params.get("round") == null ? 2 : ((Number) params.get("round")).intValue();

        LedgerRow l = pair.getLeftSingle();
        LedgerRow r = pair.getRightSingle();
        BigDecimal left = amount(l, field);
        BigDecimal right = amount(r, field);
        String leftRaw = l != null && l.getRecordData() != null ? l.getRecordData().path(field).asText(null) : null;
        String rightRaw = r != null && r.getRecordData() != null ? r.getRecordData().path(field).asText(null) : null;
        if (left == null || right == null) {
            return CompareResult.fail(List.of(new Mismatch(field, leftRaw, rightRaw, "missing", "custom")), null, 1);
        }

        BigDecimal diff = left.subtract(right).abs().setScale(round, RoundingMode.HALF_UP);
        BigDecimal tolerance = tierTolerance(params, left);
        boolean ok = diff.compareTo(tolerance) <= 0;
        if (ok) {
            return CompareResult.ok(1);
        }
        long cent = diff.movePointRight(2).longValue();
        return CompareResult.fail(List.of(new Mismatch(field, leftRaw, rightRaw, "阶梯容差:" + tolerance, "custom")),
                cent, 1);
    }

    /** 按左侧金额命中的区间容差；未配置 tiers / 未命中 → 0（精确相等） */
    private static BigDecimal tierTolerance(Map<String, Object> params, BigDecimal left) {
        if (params == null || params.get("tiers") == null) {
            return ZERO;
        }
        Object tiers = params.get("tiers");
        if (!(tiers instanceof List<?> list)) {
            return ZERO;
        }
        for (Object o : list) {
            if (!(o instanceof Map<?, ?> tier)) {
                continue;
            }
            BigDecimal min = num(tier.get("min"));
            BigDecimal max = num(tier.get("max"));
            BigDecimal tol = num(tier.get("tolerance"));
            if (min == null || max == null || tol == null) {
                continue;
            }
            if (left.compareTo(min) >= 0 && left.compareTo(max) < 0) {
                return tol;
            }
        }
        return ZERO;
    }

    private static BigDecimal num(Object v) {
        if (v == null) {
            return null;
        }
        if (v instanceof Number n) {
            return BigDecimal.valueOf(n.doubleValue());
        }
        try {
            return new BigDecimal(String.valueOf(v).trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static BigDecimal amount(LedgerRow row, String field) {
        if (row == null || row.getRecordData() == null) {
            return null;
        }
        JsonNode node = row.getRecordData().path(field);
        if (node.isMissingNode() || node.isNull()) {
            return null;
        }
        return node.isNumber() ? node.decimalValue() : num(node.asText());
    }
}
