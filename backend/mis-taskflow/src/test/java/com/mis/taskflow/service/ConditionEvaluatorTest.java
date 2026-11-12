package com.mis.taskflow.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link ConditionEvaluator} 单测（P7 图式流转）。
 */
class ConditionEvaluatorTest {

    private static final String FORM = "{\"amount\":80000,\"dept\":\"FIN\",\"urgent\":true}";

    @Test
    @DisplayName("空表达式视为无条件匹配")
    void blankIsTrue() {
        assertTrue(ConditionEvaluator.matches(null, FORM));
        assertTrue(ConditionEvaluator.matches("", FORM));
    }

    @Test
    @DisplayName("数值比较：amount > 50000")
    void numeric() {
        assertTrue(ConditionEvaluator.matches("${amount > 50000}", FORM));
        assertFalse(ConditionEvaluator.matches("${amount > 100000}", FORM));
        assertTrue(ConditionEvaluator.matches("amount >= 80000", FORM));
        assertTrue(ConditionEvaluator.matches("amount <= 80000", FORM));
    }

    @Test
    @DisplayName("字符串比较：dept == \"FIN\"")
    void string() {
        assertTrue(ConditionEvaluator.matches("${dept == \"FIN\"}", FORM));
        assertFalse(ConditionEvaluator.matches("${dept == \"HR\"}", FORM));
        assertTrue(ConditionEvaluator.matches("dept != \"HR\"", FORM));
    }

    @Test
    @DisplayName("布尔与逻辑组合")
    void logical() {
        assertTrue(ConditionEvaluator.matches("${urgent == true}", FORM));
        assertTrue(ConditionEvaluator.matches("${amount > 50000 && dept == \"FIN\"}", FORM));
        assertFalse(ConditionEvaluator.matches("${amount > 50000 && dept == \"HR\"}", FORM));
        assertTrue(ConditionEvaluator.matches("${amount > 99999 || dept == \"FIN\"}", FORM));
    }

    @Test
    @DisplayName("缺失变量与非法表达式保守返回 false")
    void missingVar() {
        assertFalse(ConditionEvaluator.matches("${notExist > 1}", FORM));
        assertFalse(ConditionEvaluator.matches("garbage expression", FORM));
    }
}
