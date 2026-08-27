package com.mis.recon.service.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.recon.domain.runtime.CompareResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * compareSum 单测（T05-spec-sum-check §13.2 C 组，5 条）。
 */
class CompareSumTest {

    private CompareEngine engine;

    @BeforeEach
    void setUp() {
        engine = new CompareEngine(org.mockito.Mockito.mock(CustomLoader.class));
    }

    private CompareEngine.SumRuleConfig sumRule(String name, String leftExpr, String rightExpr,
                                                String toleranceType, String toleranceValue, boolean isAmount) {
        CompareEngine.SumRuleConfig r = new CompareEngine.SumRuleConfig();
        r.name = name;
        r.leftExpr = leftExpr;
        r.rightExpr = rightExpr;
        r.toleranceType = toleranceType == null ? "null" : toleranceType;
        if (toleranceValue != null) {
            r.toleranceValue = new BigDecimal(toleranceValue);
        }
        r.isAmount = isAmount;
        return r;
    }

    private static JsonNode data(String json) {
        try {
            return new ObjectMapper().readTree(json);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    void equalSidesConsistent() {
        // C1：左右相等 → 一致（总额 100 = 积分 10 + 现金 40 + 券 50）
        CompareResult r = engine.compareSum("orders", data(
                "{\"total_amount\":\"100.00\",\"integral_amount\":\"10\",\"cash_card_amount\":\"40\",\"coupon_amount\":\"50\"}"),
                sumRule("总额勾稽", "orders.total_amount",
                        "orders.integral_amount + orders.cash_card_amount + orders.coupon_amount",
                        null, null, true));
        assertTrue(r.isConsistent());
        assertEquals(1, r.getComparedFields());
        assertNull(r.getDiffAmountCent());
    }

    @Test
    void diffWithinToleranceConsistent() {
        // C2：差在容差内 → 一致（is_amount 分单位：100.00 vs 99.00 差 100 分 <= 100 分容差）
        CompareResult r = engine.compareSum("orders", data(
                "{\"total_amount\":\"100.00\",\"integral_amount\":\"10\",\"cash_card_amount\":\"40\",\"coupon_amount\":\"49\"}"),
                sumRule("总额勾稽", "orders.total_amount",
                        "orders.integral_amount + orders.cash_card_amount + orders.coupon_amount",
                        "absolute", "100", true));
        assertTrue(r.isConsistent());
    }

    @Test
    void diffExceedToleranceFieldMismatch() {
        // C3：差超容差 → FIELD_MISMATCH（100.00 vs 98.00 差 200 分 > 100 分）
        CompareResult r = engine.compareSum("orders", data(
                "{\"total_amount\":\"100.00\",\"integral_amount\":\"10\",\"cash_card_amount\":\"40\",\"coupon_amount\":\"48\"}"),
                sumRule("总额勾稽", "orders.total_amount",
                        "orders.integral_amount + orders.cash_card_amount + orders.coupon_amount",
                        "absolute", "100", true));
        assertFalse(r.isConsistent());
        assertEquals(1, r.getMismatches().size());
        assertEquals(200L, r.getDiffAmountCent());
        assertEquals("equal", r.getMismatches().get(0).getEqRule());
    }

    @Test
    void missingFieldIsMissing() {
        // C4：右表达式缺字段（coupon_amount 缺失）→ MISSING（eqRule=missing，可区分）
        CompareResult r = engine.compareSum("orders", data(
                "{\"total_amount\":\"100.00\",\"integral_amount\":\"10\",\"cash_card_amount\":\"40\"}"),
                sumRule("总额勾稽", "orders.total_amount",
                        "orders.integral_amount + orders.cash_card_amount + orders.coupon_amount",
                        null, null, true));
        assertFalse(r.isConsistent());
        assertEquals("missing", r.getMismatches().get(0).getEqRule());
        assertNull(r.getDiffAmountCent());
    }

    @Test
    void nonAmountBranch() {
        // C5：is_amount=false 分支正确（原值比较，不产生 diffAmountCent）
        // 一致：a + b = c * 6 = 30
        CompareResult ok = engine.compareSum("orders", data("{\"a\":\"10\",\"b\":\"20\",\"c\":\"5\"}"),
                sumRule("分量校验", "orders.a + orders.b", "orders.c * 6", null, null, false));
        assertTrue(ok.isConsistent());
        // 不一致：a + b = 30 vs c = 5，无金额分差
        CompareResult fail = engine.compareSum("orders", data("{\"a\":\"10\",\"b\":\"20\",\"c\":\"5\"}"),
                sumRule("分量校验", "orders.a + orders.b", "orders.c", null, null, false));
        assertFalse(fail.isConsistent());
        assertEquals("equal", fail.getMismatches().get(0).getEqRule());
        assertNull(fail.getDiffAmountCent());
    }
}
