package com.mis.kb.domain.service;

import com.mis.kb.domain.model.EngineModel;
import com.mis.kb.domain.model.EngineModelPool;
import com.mis.kb.engine.KnowledgeEnginePort;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 模型池缓存单测（T02 验收，设计 §3.2.4 / §8-8）。
 *
 * <p>四类必测：60s TTL 内命中缓存不重打引擎；invalidate 后重新探测；
 * 探测失败返回 unavailable 降级态（绝不当空列表）；peekPool 只读缓存绝不触发网络。
 */
class EngineModelPoolServiceTest {

    private static EngineModelPool okPool() {
        return new EngineModelPool(
                List.of(new EngineModel("text-embedding-v3@P@P", "text-embedding-v3",
                        EngineModel.TYPE_EMBEDDING, "P", null, null)),
                List.of(new EngineModel("qwen3-rerank@P@P", "qwen3-rerank",
                        EngineModel.TYPE_RERANK, "P", null, null)),
                true, null, "qwen3-rerank@P@P", Instant.now());
    }

    @Test
    @DisplayName("60s TTL 内命中缓存：两次 getPool 只打一次引擎")
    void getPoolHitsCacheWithinTtl() {
        KnowledgeEnginePort port = mock(KnowledgeEnginePort.class);
        EngineModelPool probed = okPool();
        when(port.probeModelPool()).thenReturn(probed);
        EngineModelPoolService service = new EngineModelPoolService(port);

        EngineModelPool first = service.getPool();
        EngineModelPool second = service.getPool();

        assertSame(probed, first);
        assertSame(probed, second);
        verify(port, times(1)).probeModelPool();
    }

    @Test
    @DisplayName("invalidate 后重新探测（手动失效语义）")
    void invalidateForcesReprobe() {
        KnowledgeEnginePort port = mock(KnowledgeEnginePort.class);
        when(port.probeModelPool()).thenReturn(okPool());
        EngineModelPoolService service = new EngineModelPoolService(port);

        service.getPool();
        service.invalidate();
        service.getPool();

        verify(port, times(2)).probeModelPool();
    }

    @Test
    @DisplayName("探测失败 → available=false + 原因（绝不当空列表）")
    void probeFailureYieldsUnavailablePool() {
        KnowledgeEnginePort port = mock(KnowledgeEnginePort.class);
        when(port.probeModelPool()).thenThrow(new IllegalStateException("engine down"));
        EngineModelPoolService service = new EngineModelPoolService(port);

        EngineModelPool pool = service.getPool();

        assertFalse(pool.available());
        assertNotNull(pool.degradedReason());
        assertTrue(pool.degradedReason().contains("engine down"));
        assertTrue(pool.embedding().isEmpty());
        assertTrue(pool.rerank().isEmpty());
    }

    @Test
    @DisplayName("peekPool 只读缓存：未探测时返回 null 且绝不触发网络")
    void peekPoolNeverTriggersNetwork() {
        KnowledgeEnginePort port = mock(KnowledgeEnginePort.class);
        EngineModelPoolService service = new EngineModelPoolService(port);

        assertNull(service.peekPool());
        verify(port, never()).probeModelPool();
    }

    @Test
    @DisplayName("peekPool 返回有效缓存且不新增引擎调用")
    void peekPoolReturnsValidCache() {
        KnowledgeEnginePort port = mock(KnowledgeEnginePort.class);
        EngineModelPool probed = okPool();
        when(port.probeModelPool()).thenReturn(probed);
        EngineModelPoolService service = new EngineModelPoolService(port);

        service.getPool();
        assertSame(probed, service.peekPool());
        verify(port, times(1)).probeModelPool();
    }
}
