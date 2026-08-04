package com.mis.kb.api.dto;

import com.mis.kb.domain.model.RagSettings;
import jakarta.validation.constraints.NotBlank;

/** 知识库更新请求。 */
public record KbLibraryUpdateRequest(
        @NotBlank String name,
        @NotBlank String secrecy,
        Integer status,
        RagSettings settings) {
}
