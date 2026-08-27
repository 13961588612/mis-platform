package com.mis.recon.util;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * 金额标准化单测（共享知识 #1 验收样例 + V19/V33 边界）。
 */
class AmountUtilTest {

    @Test
    void yuanAsIsToCent() {
        assertEquals(10000L, AmountUtil.toCent("100.00", "yuan", "as_is"));
    }

    @Test
    void yuanNegateToCent() {
        assertEquals(-150L, AmountUtil.toCent("1.50", "yuan", "negate"));
    }

    @Test
    void pointUnitReturnsNull() {
        assertNull(AmountUtil.toCent("100", "point", "as_is"));
    }

    @Test
    void nonMonetaryReturnsNull() {
        assertNull(AmountUtil.toCent("100", "non_monetary", "as_is"));
    }

    @Test
    void illegalRawReturnsNull() {
        assertNull(AmountUtil.toCent("abc", "yuan", "as_is"));
        assertNull(AmountUtil.toCent("", "yuan", "as_is"));
        assertNull(AmountUtil.toCent(null, "yuan", "as_is"));
    }

    @Test
    void v19ThreeDecimalsRejected() {
        assertNull(AmountUtil.toCent("1.005", "yuan", "as_is"));
    }

    @Test
    void negativeRawKeepsSign() {
        assertEquals(-10000L, AmountUtil.toCent("-100.00", "yuan", "as_is"));
    }

    @Test
    void absAndToYuan() {
        assertEquals(100L, AmountUtil.abs(-100L));
        assertEquals(0, AmountUtil.toYuan(150L).compareTo(new java.math.BigDecimal("1.50")));
        assertNull(AmountUtil.toYuan(null));
    }
}
