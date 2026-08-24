package com.mis.adminbff.dto.iqd;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 问数引用（与 Python {@code models/iqd_schema.py::Citation} 同构，§4.3）。
 *
 * @param kind        引用类型（table / column / metric / document / knowledge）
 * @param itemKey     被引用条目键（表名 / 列名 / 指标键 / 文档键）
 * @param displayName 展示名
 * @param description 描述（可空）
 * @param snippet     引用片段（可空）
 * @param sourceRef   来源引用（可空）
 */
public record IqdCitation(
        String kind,
        @JsonProperty("item_key") String itemKey,
        @JsonProperty("display_name") String displayName,
        String description,
        String snippet,
        @JsonProperty("source_ref") String sourceRef) {
}
