package com.mis.kb.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.Instant;

/** 分类创建请求。 */
public record KbCategoryCreateRequest(
        @NotBlank String name,
        Long parentId,
        @NotNull Integer enabled,
        Integer sort,
        String remark) {
}
