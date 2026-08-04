package com.mis.adminbff.dto.kb;

import java.time.Instant;

/** 知识库文档视图（BFF 侧镜像，不暴露引擎原生 id）。 */
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
