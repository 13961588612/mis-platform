package com.mis.kb.api.dto;

import java.util.List;

/**
 * 文档切片分页响应（「查看文档切分效果」抽屉）。
 *
 * <p>空态由 {@code hint} 承载：解析中/解析失败/未同步到引擎/引擎暂不可达时
 * {@code chunks} 为空列表且 {@code hint} 非空；正常态 {@code hint} 为 {@code null}。
 *
 * @param stats    统计条（恒非 {@code null}）
 * @param chunks   当前页切片（恒非 {@code null}，可能为空列表）
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
