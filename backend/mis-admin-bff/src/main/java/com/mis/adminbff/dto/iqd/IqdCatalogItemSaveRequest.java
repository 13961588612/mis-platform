package com.mis.adminbff.dto.iqd;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 清单项保存请求（POST /api/v1/iqd/catalog/batch；snake_case wire）。
 *
 * @param kind             table|column|model|relationship|metric|dimension|view
 * @param parentKey        父键
 * @param itemKey          稳定键
 * @param displayName      展示名
 * @param dataType         数据类型
 * @param isPrimaryKey     是否主键
 * @param isTimeDimension  是否时间维度
 * @param isEmail          是否邮箱列
 * @param description      描述
 * @param expression       表达式
 * @param source           db_meta | mdl
 * @param inScope          是否纳入问数范围
 * @param sensitiveLevel   none | low | high
 * @param maskRule         脱敏规则名
 */
public record IqdCatalogItemSaveRequest(
        String kind,
        @JsonProperty("parent_key") String parentKey,
        @JsonProperty("item_key") String itemKey,
        @JsonProperty("display_name") String displayName,
        @JsonProperty("data_type") String dataType,
        @JsonProperty("is_primary_key") Boolean isPrimaryKey,
        @JsonProperty("is_time_dimension") Boolean isTimeDimension,
        @JsonProperty("is_email") Boolean isEmail,
        String description,
        String expression,
        String source,
        @JsonProperty("in_scope") Boolean inScope,
        @JsonProperty("sensitive_level") String sensitiveLevel,
        @JsonProperty("mask_rule") String maskRule) {
}
