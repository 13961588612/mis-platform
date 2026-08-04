package com.mis.kb.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/** 分类更新请求。 */
public record KbCategoryUpdateRequest(
        @NotBlank String name,
        @NotNull Integer enabled,
        Integer sort,
        String remark) {
}
