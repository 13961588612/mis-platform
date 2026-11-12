package com.mis.adminbff.dto.iqd;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 问数结果列元数据（与 Python {@code models/iqd_schema.py::ColumnMeta} 同构，§4.3）。
 *
 * @param name        列名
 * @param itemKey     语义键（表键/字段键/mdl 键）
 * @param dataType    数据类型（varchar / numeric / date ...）
 * @param displayName 展示名
 * @param masked      是否脱敏
 */
public record IqdColumnMeta(
        String name,
        @JsonProperty("item_key") String itemKey,
        @JsonProperty("data_type") String dataType,
        @JsonProperty("display_name") String displayName,
        Boolean masked) {
}
