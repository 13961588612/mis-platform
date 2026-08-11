package com.mis.kb.domain.model;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 引擎能力位单测（引擎删除策略 P0 / T01 + T02 验收点 4）。
 *
 * <p>要守住的核心不变式：<b>{@code capabilities} 列表与五个布尔位严格一致</b>。
 * 这两者一旦漂移，前端按列表显隐、后端按布尔位判断，就会出现「按钮亮着、点了被拒」
 * 或更糟的「按钮亮着、真把引擎库删了」。删除能力位是本次 P0 唯一的物理删除闸门，
 * 尤其不能让它出现「布尔位 false 但列表含 delete」这种半开状态。
 */
@DisplayName("T01 EngineCapabilities 能力位")
class EngineCapabilitiesTest {

    @Test
    @DisplayName("deleteSupported 是 record 的第 5 个布尔位（末位追加，不打乱既有顺序）")
    void deleteShouldBeLastComponent() {
        EngineCapabilities caps = EngineCapabilities.of(true, true, true, true, true);

        assertTrue(caps.rerankSupported());
        assertTrue(caps.metadataFilterSupported());
        assertTrue(caps.replaceSupported());
        assertTrue(caps.hybridSupported());
        assertTrue(caps.deleteSupported(), "第 5 位必须是 delete");
        assertTrue(caps.capabilities().contains(EngineCapabilities.CAP_DELETE));
    }

    @Test
    @DisplayName("delete=false 时 capabilities 数组不得含 \"delete\"（当前生产口径）")
    void shouldNotListDeleteWhenUnsupported() {
        EngineCapabilities caps = EngineCapabilities.of(true, true, true, true, false);

        assertFalse(caps.deleteSupported());
        assertFalse(caps.capabilities().contains(EngineCapabilities.CAP_DELETE),
                "布尔位 false 却在列表里挂 delete，前端就会把物理删除按钮点亮");
        assertFalse(caps.supports(EngineCapabilities.CAP_DELETE));
        // 其余四项不受影响
        assertTrue(caps.supports(EngineCapabilities.CAP_HYBRID));
        assertTrue(caps.supports(EngineCapabilities.CAP_RERANK));
        assertTrue(caps.supports(EngineCapabilities.CAP_METADATA_FILTER));
        assertTrue(caps.supports(EngineCapabilities.CAP_REPLACE));
    }

    @Test
    @DisplayName("仅 delete 为 true 时列表只有 delete，不会被 UNSUPPORTED 顶掉")
    void shouldListOnlyDelete() {
        EngineCapabilities caps = EngineCapabilities.of(false, false, false, false, true);

        assertEquals(1, caps.capabilities().size());
        assertEquals(EngineCapabilities.CAP_DELETE, caps.capabilities().get(0));
    }

    @Test
    @DisplayName("五位全 false 时等价 unsupported()，列表为 [UNSUPPORTED]")
    void shouldFallbackToUnsupported() {
        EngineCapabilities caps = EngineCapabilities.of(false, false, false, false, false);

        assertEquals(EngineCapabilities.unsupported().capabilities(), caps.capabilities());
        assertFalse(caps.deleteSupported());
    }

    @Test
    @DisplayName("unsupported() 的 deleteSupported 必须为 false（noop 引擎不得声明可删）")
    void unsupportedShouldNotAllowDelete() {
        EngineCapabilities caps = EngineCapabilities.unsupported();

        assertFalse(caps.deleteSupported());
        assertFalse(caps.supports(EngineCapabilities.CAP_DELETE));
    }

    @Test
    @DisplayName("capabilities 列表不可变（防调用方偷偷加一个 delete 进去）")
    void capabilitiesShouldBeImmutable() {
        EngineCapabilities caps = EngineCapabilities.of(true, true, true, true, false);

        org.junit.jupiter.api.Assertions.assertThrows(
                UnsupportedOperationException.class,
                () -> caps.capabilities().add(EngineCapabilities.CAP_DELETE));
    }
}
