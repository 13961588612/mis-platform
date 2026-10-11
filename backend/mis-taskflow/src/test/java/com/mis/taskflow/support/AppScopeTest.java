package com.mis.taskflow.support;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * {@link AppScope} 单元测试 —— 纯逻辑，不连库，恒可运行。
 *
 * <p>P0 的 {@code AppScopeResolver}（含绑定表兜底推导）已作废删除；此处仅覆盖保留下来的
 * scope 归一化与空白归一逻辑（其「由业务类型推导 APP」的用例随绑定表一并删除）。
 */
class AppScopeTest {

    @Test
    @DisplayName("normalizeScope：仅识别 APP/PLATFORM（大小写不敏感、去空白），其余归 ALL")
    void normalizeScope() {
        assertEquals("APP", AppScope.normalizeScope("app"));
        assertEquals("APP", AppScope.normalizeScope(" APP "));
        assertEquals("PLATFORM", AppScope.normalizeScope("platform"));
        assertEquals("PLATFORM", AppScope.normalizeScope(" PLATFORM "));
        assertEquals("ALL", AppScope.normalizeScope(null));
        assertEquals("ALL", AppScope.normalizeScope(""));
        assertEquals("ALL", AppScope.normalizeScope("   "));
        assertEquals("ALL", AppScope.normalizeScope("ALL"));
        assertEquals("ALL", AppScope.normalizeScope("garbage"));
    }

    @Test
    @DisplayName("trimToNull：空白归一为 null（null = 平台级），非空去首尾空白")
    void trimToNull() {
        assertNull(AppScope.trimToNull(null));
        assertNull(AppScope.trimToNull(""));
        assertNull(AppScope.trimToNull("   "));
        assertEquals("kb", AppScope.trimToNull("  kb  "));
    }
}
