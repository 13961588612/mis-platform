package com.mis.taskflow.support;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link AuditDiffUtils} 单测（P4）：纯逻辑，无需数据库。
 */
class AuditDiffUtilsTest {

    @Test
    @DisplayName("P4：修改字段应产出 field/old/new")
    void modifiedField() {
        String diff = AuditDiffUtils.diff(
                "{\"amount\":50000,\"vendor\":\"A\"}",
                "{\"amount\":65000,\"vendor\":\"A\"}");
        assertTrue(diff.contains("\"field\":\"amount\""), diff);
        assertTrue(diff.contains("\"old\":\"50000\""), diff);
        assertTrue(diff.contains("\"new\":\"65000\""), diff);
        assertTrue(!diff.contains("\"field\":\"vendor\""), "未变更字段不应出现: " + diff);
    }

    @Test
    @DisplayName("P4：新增字段 old 为空")
    void addedField() {
        String diff = AuditDiffUtils.diff("{\"a\":1}", "{\"a\":1,\"b\":2}");
        assertTrue(diff.contains("\"field\":\"b\""), diff);
        assertTrue(diff.contains("\"new\":\"2\""), diff);
    }

    @Test
    @DisplayName("P4：删除字段 new 为空")
    void removedField() {
        String diff = AuditDiffUtils.diff("{\"a\":1,\"b\":2}", "{\"a\":1}");
        assertTrue(diff.contains("\"field\":\"b\""), diff);
        assertTrue(diff.contains("\"old\":\"2\""), diff);
    }

    @Test
    @DisplayName("P4：嵌套对象产出点号路径")
    void nestedField() {
        String diff = AuditDiffUtils.diff(
                "{\"amount\":{\"value\":1,\"currency\":\"CNY\"}}",
                "{\"amount\":{\"value\":2,\"currency\":\"CNY\"}}");
        assertTrue(diff.contains("\"field\":\"amount.value\""), diff);
    }

    @Test
    @DisplayName("P4：无变更返回空数组")
    void noChange() {
        assertEquals("[]", AuditDiffUtils.diff("{\"a\":1}", "{\"a\":1}"));
    }

    @Test
    @DisplayName("P4：空输入不抛异常")
    void blankInputs() {
        assertEquals("[]", AuditDiffUtils.diff(null, null));
        assertEquals("[]", AuditDiffUtils.diff("", ""));
    }
}