package com.mis.adminbff.dto.kb;

import java.time.Instant;

/**
 * 知识库文档视图（BFF 侧镜像，不暴露引擎原生 id）。
 *
 * <p>kb_settings_model_chunk（R-P0-06）末位追加三列：{@code chunkMethod} / {@code chunkTokenNum} /
 * {@code separator}，均为本地字段（来自 {@code kb_document}），不额外调引擎。
 *
 * <p>企业级增强一期（KE-03/KE-04）末位追加 {@code parseProgress} / {@code parseError}，
 * 与 mis-kb {@code KbDocumentVO} 对齐；由 Jackson 反序列化透传。
 *
 * <p>T4 末位追加 {@code pageIndex} / {@code imageTableContextWindow} / {@code autoKeywords} /
 * {@code autoQuestions}（文件级解析器设置，null = 继承库级；只落库不下发），
 * 同样由 Jackson 反序列化透传。
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
        String parseError,
        Boolean pageIndex,
        Integer imageTableContextWindow,
        Integer autoKeywords,
        Integer autoQuestions) {
}
