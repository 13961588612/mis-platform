package com.mis.adminbff.dto.kb;

import java.util.List;

/**
 * 文档切片分页响应（BFF 侧镜像，与 mis-kb {@code KbDocumentChunksVO} 对齐）。
 *
 * @param stats    统计条
 * @param chunks   当前页切片
 * @param total    关键字过滤后的总条数
 * @param page     当前页码（1-based）
 * @param pageSize 每页条数
 * @param hint     空态提示；正常态为 {@code null}
 */
public record KbDocumentChunksVO(
        KbDocumentChunkStatsVO stats,
        List<KbDocumentChunkVO> chunks,
        int total,
        int page,
        int pageSize,
        String hint) {
}
