package com.mis.adminbff.dto.kb;

import java.time.Instant;

/**
 * 知识库文档视图（BFF 侧镜像，不暴露引擎原生 id）。
 *
 * <p>kb_settings_model_chunk（R-P0-06）末位追加三列：{@code chunkMethod} / {@code chunkTokenNum} /
 * {@code separator}，均为本地字段（来自 {@code kb_document}），不额外调引擎。
 */
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
        Instant updatedAt,
        String chunkMethod,
        Integer chunkTokenNum,
        String separator) {
}
