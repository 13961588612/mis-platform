package com.mis.kb.api.dto;

import com.mis.kb.domain.model.RagSettings;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/** 知识库创建请求。 */
public record KbLibraryCreateRequest(
        @NotNull Long categoryId,
        @NotBlank String name,
        @NotBlank String secrecy,
        Long owner,
        RagSettings settings) {
}
