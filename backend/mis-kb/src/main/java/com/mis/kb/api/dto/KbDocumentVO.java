package com.mis.kb.api.dto;

import java.time.Instant;

/** 文档视图对象（不暴露 {@code engine_document_ref} 引擎原生 id）。 */
public record KbDocumentVO(
        Long id,
        Long libraryId,
        String title,
        Integer version,
        String parseStatus,
        Integer enabled,
        Long size,
        String format,
        Instant createdAt,
        Instant updatedAt) {
}
