package com.mis.recon.util;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * ExpressionEvaluator 单测（T05-spec-sum-check §13.1 E 组，10 条）。
 */
class ExpressionEvaluatorTest {

    private static final Map<String, BigDecimal> F = Map.of(
            "orders.total_amount", new BigDecimal("100.00"),
            "orders.a", new BigDecimal("10"),
            "orders.b", new BigDecimal("20"),
            "orders.c", new BigDecimal("5"),
            "orders.d", new BigDecimal("2"),
            "orders.e", new BigDecimal("4"),
            "orders.x", new BigDecimal("-3"));

    private static BigDecimal ev(String expr) {
        return ExpressionEvaluator.evaluate(expr, F);
    }

    @Test
    void singleFieldReference() {
        // E1：单字段引用 orders.total_amount 取值
        assertEquals(new BigDecimal("100.00"), ev("orders.total_amount"));
    }

    @Test
    void mixedArithmeticPrecision() {
        // E2：四则混合 a + b - c * d / e（BigDecimal 精度；10 + 20 - 5*2/4 = 27.5）
        assertEquals(new BigDecimal("27.500000"), ev("orders.a + orders.b - orders.c * orders.d / orders.e"));
    }

    @Test
    void parenthesisPrecedence() {
        // E3：括号优先级 (a + b) * c = 30 * 5 = 150
        assertEquals(new BigDecimal("150"), ev("(orders.a + orders.b) * orders.c"));
    }

    @Test
    void unaryMinus() {
        // E4：单目负号 -a + b = -10 + 20 = 10
        assertEquals(new BigDecimal("10"), ev("-orders.a + orders.b"));
        // 负值字段本身
        assertEquals(new BigDecimal("-3"), ev("orders.x"));
    }

    @Test
    void pureNumberExpression() {
        // E5：纯数字表达式 100 + 50
        assertEquals(new BigDecimal("150"), ev("100 + 50"));
    }

    @Test
    void divisionByZeroReturnsNull() {
        // E6：除零 → null（不抛异常）
        assertNull(ev("orders.a / 0"));
        assertNull(ev("1 / (orders.b - orders.b)"));
    }

    @Test
    void missingFieldReturnsNull() {
        // E7：缺失字段引用 → null
        assertNull(ev("orders.not_exist"));
        assertNull(ev("orders.a + orders.not_exist"));
        // 非数值字段（不在 fieldValues 中）同样按缺失处理
        assertNull(ExpressionEvaluator.evaluate("orders.str_field", Map.of()));
    }

    @Test
    void illegalSyntaxReturnsNull() {
        // E8：非法语法 → null
        assertNull(ev("orders.a + + orders.b"));   // 单目正号不支持
        assertNull(ev("(orders.a + orders.b"));     // 括号不配对
        assertNull(ev("orders.a orders.b"));        // 操作数相邻无运算符
        assertNull(ev("orders.a +"));               // 尾运算符
        assertNull(ev("()"));
        assertNull(ev("orders.a @ 1"));             // 未知字符
    }

    @Test
    void emptyOrBlankReturnsNull() {
        // E9：空表达式/纯空白 → null
        assertNull(ExpressionEvaluator.evaluate(null, F));
        assertNull(ExpressionEvaluator.evaluate("", F));
        assertNull(ExpressionEvaluator.evaluate("   ", F));
        assertNull(ExpressionEvaluator.evaluate(" \t\n ", F));
    }

    @Test
    void decimalPrecisionNoFloatError() {
        // E10：金额精度 0.1 + 0.2 无浮点误差
        BigDecimal v = ExpressionEvaluator.evaluate("0.1 + 0.2", F);
        assertEquals(new BigDecimal("0.3"), v);
    }
}
