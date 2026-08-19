package com.mis.kb.domain.model;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 文件级切片配置校验常量单测（设计 §3.2.2「常量唯一事实源」）。
 *
 * <p>chunkTokenNum 合法区间 [256, 2048]：null（未指定）放行；
 * 下界 256 恰好合法、255 非法；上界 2048 恰好合法、2049 非法。
 * 与 {@link RagSettingsService}（库级）共用同一份常量，口径必须一致。
 */
class DocumentChunkConfigTest {

    @Test
    @DisplayName("chunkTokenNum 边界 [256, 2048]：null/两端合法，越界非法")
    void tokenNumBoundary() {
        assertTrue(DocumentChunkConfig.isValidTokenNum(null), "未指定（继承库级）应放行");
        assertTrue(DocumentChunkConfig.isValidTokenNum(256), "下界 256 恰好合法");
        assertTrue(DocumentChunkConfig.isValidTokenNum(2048), "上界 2048 恰好合法");
        assertTrue(DocumentChunkConfig.isValidTokenNum(1024), "区间内任意值合法");

        assertFalse(DocumentChunkConfig.isValidTokenNum(255), "255 低于下界应非法");
        assertFalse(DocumentChunkConfig.isValidTokenNum(16), "旧下界 16 已废弃应非法");
        assertFalse(DocumentChunkConfig.isValidTokenNum(2049), "2049 高于上界应非法");
        assertFalse(DocumentChunkConfig.isValidTokenNum(4096), "4096 超出 RAGFlow 硬上限应非法");
        assertFalse(DocumentChunkConfig.isValidTokenNum(0), "0 非法");
        assertFalse(DocumentChunkConfig.isValidTokenNum(-1), "负数非法");
    }
}
