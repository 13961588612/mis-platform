package com.mis.kb.api.dto;

import java.time.Instant;

/**
 * 文档视图对象（不暴露 {@code engine_document_ref} 引擎原生 id）。
 *
 * <p>企业级增强一期（KE-03/KE-04）末位追加 {@code parseProgress} / {@code parseError}：
 * 解析进度百分比与失败原因摘要，来源引擎状态同步回写（见 {@code KbDocumentService}）。
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
        String separator,
        Integer parseProgress,
        String parseError) {
}
