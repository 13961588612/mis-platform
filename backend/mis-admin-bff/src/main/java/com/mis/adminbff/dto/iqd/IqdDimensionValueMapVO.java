package com.mis.adminbff.dto.iqd;

import com.fasterxml.jackson.annotation.JsonProperty;

/** 行级维度值映射 VO / 保存请求（snake_case wire）。 */
public record IqdDimensionValueMapVO(
        Long id,
        @JsonProperty("connection_id") Long connectionId,
        @JsonProperty("dimension_code") String dimensionCode,
        @JsonProperty("mis_value") String misValue,
        @JsonProperty("external_value") String externalValue,
        Boolean effective,
        @JsonProperty("covers_subtree") Boolean coversSubtree,
        String remark,
        @JsonProperty("created_at") String createdAt,
        @JsonProperty("updated_at") String updatedAt) {
}
