package com.mis.adminbff.dto.iqd;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * 样本对分类新建/更新（BFF → mis-iqd；snake_case wire）。
 */
public record IqdSqlPairCategorySaveRequest(
        @NotNull @JsonProperty("connection_id") Long connectionId,
        @JsonProperty("parent_id") Long parentId,
        @NotBlank String code,
        @NotBlank String name,
        @JsonProperty("sort_order") Integer sortOrder,
        Boolean enabled) {
}
