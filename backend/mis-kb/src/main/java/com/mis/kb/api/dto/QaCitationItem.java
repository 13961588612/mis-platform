package com.mis.kb.api.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 单条引用项（仅 MIS 业务 ID）。
 *
 * <p>由 mis-rag 在 {@code _persist} 阶段回传；F-04 新增 {@code offset}/{@code page}/{@code source}，
 * 三者均可空——引擎给不出位置信息时不阻断落库。
 */
public record QaCitationItem(
        @NotNull Long libraryId,
        @NotNull Long documentId,
        String chunkText,
        Double score,
        Integer offset,
        Integer page,
        String source) {

    /** 兼容旧调用方（无位置信息）的便捷构造。 */
    public QaCitationItem(Long libraryId, Long documentId, String chunkText, Double score) {
        this(libraryId, documentId, chunkText, score, null, null, null);
    }
}
