package com.mis.recon.util;

import java.math.BigDecimal;

/**
 * 金额标准化唯一入口（共享知识 #1 金额三态律 P-2）：
 * 原始态 → 计算态 toCent（整数分，唯一换算入口），BigDecimal 运算禁 double。
 * <p>公式：amount_cent = ROUND(原始值 × (unit=yuan?100:1)) × sign_factor</p>
 * <ul>
 *   <li>unit=point/non_monetary：非货币计量，返回 null（V33：积分不是钱，不进 amount_cent）</li>
 *   <li>raw 非法（null/空白/非数字/小数位 &gt; 2）：返回 null（V19：三位以上小数 ROUND 会丢精度）</li>
 *   <li>结果超 BIGINT：返回 null（防溢出静默错位）</li>
 * </ul>
 */
public final class AmountUtil {

    private AmountUtil() {
    }

    /**
     * 原始金额 → 整数分。
     *
     * @param raw      源行金额原始值（字符串）
     * @param unit     单位：yuan / point / non_monetary（AmountEnums.AmountUnit.name()）
     * @param signRule 符号规则：as_is / negate（same_table_negative 属 as_is：负数天然）
     * @return 整数分 Long；非货币单位或非法值 → null
     */
    public static Long toCent(String raw, String unit, String signRule) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        if (unit == null || !"yuan".equals(unit)) {
            // point / non_monetary / 未知单位：一律不进 amount_cent（V33 语义）
            return null;
        }
        BigDecimal value;
        try {
            value = new BigDecimal(raw.trim());
        } catch (NumberFormatException e) {
            return null;
        }
        // V19：小数位 > 2 拒绝（ROUND(×100) 会丢精度）
        if (value.scale() > 2) {
            return null;
        }
        BigDecimal cent = value.multiply(BigDecimal.valueOf(100));
        if ("negate".equals(signRule)) {
            cent = cent.negate();
        }
        try {
            return cent.longValueExact();
        } catch (ArithmeticException e) {
            return null;   // 超 BIGINT 范围，防溢出
        }
    }

    public static long abs(long v) {
        return v < 0 ? -v : v;
    }

    /**
     * 展示层：分 → 元（BigDecimal 两位，非比较路径；null → null）。
     */
    public static BigDecimal toYuan(Long cent) {
        if (cent == null) {
            return null;
        }
        return BigDecimal.valueOf(cent).divide(BigDecimal.valueOf(100), 2, java.math.RoundingMode.HALF_UP);
    }
}
