package com.mis.kb.api.dto;

/**
 * 检索命中片段视图（仅含 MIS 业务 ID）。
 *
 * <p>F-04：{@code offset}/{@code page} 为溯源定位信息，可能为 {@code null}。
 */
public record ChunkHitVO(
        Long libraryId,
        Long documentId,
        String chunkText,
        Double score,
        String docTitle,
        Integer offset,
        Integer page) {
}
