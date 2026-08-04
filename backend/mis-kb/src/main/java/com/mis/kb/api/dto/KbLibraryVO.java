package com.mis.kb.api.dto;

import com.mis.kb.domain.model.RagSettings;

import java.time.Instant;

/**
 * 知识库视图对象（对外只含 MIS ID；不暴露 {@code engine_library_ref} 引擎原生 id）。
 */
public record KbLibraryVO(
        Long id,
        Long categoryId,
        String name,
        String secrecy,
        Integer status,
        Long owner,
        String engineType,
        RagSettings settings,
        Long docCount,
        Instant createdAt,
        Instant updatedAt) {
}
