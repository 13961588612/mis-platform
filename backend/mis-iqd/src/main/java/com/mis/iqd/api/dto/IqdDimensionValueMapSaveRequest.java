package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 行级维度值映射保存请求（POST /api/v1/iqd/dimension-value-maps；snake_case wire）。
 */
public record IqdDimensionValueMapSaveRequest(
        @JsonProperty("connection_id") Long connectionId,
        @JsonProperty("dimension_code") String dimensionCode,
        @JsonProperty("mis_value") String misValue,
        @JsonProperty("external_value") String externalValue,
        Boolean effective,
        @JsonProperty("covers_subtree") Boolean coversSubtree,
        String remark) {
}
