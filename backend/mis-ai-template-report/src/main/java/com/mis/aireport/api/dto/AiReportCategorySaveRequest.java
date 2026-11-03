package com.mis.aireport.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;

public record AiReportCategorySaveRequest(
        @JsonProperty("parent_id") Long parentId,
        @NotBlank String code,
        @NotBlank String name,
        @JsonProperty("is_group") Boolean isGroup,
        @JsonProperty("sort_order") Integer sortOrder,
        Boolean enabled) {
}
