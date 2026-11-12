package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * 样本对分类新建/更新请求（snake_case wire）。
 *
 * @param connectionId 所属连接（必填）
 * @param parentId     父节点；null/0 = 根
 * @param code         连接内唯一编码
 * @param name         展示名
 * @param sortOrder    排序（可空，默认 0）
 * @param enabled      是否启用（可空，默认 true）
 */
public record IqdSqlPairCategorySaveRequest(
        @NotNull @JsonProperty("connection_id") Long connectionId,
        @JsonProperty("parent_id") Long parentId,
        @NotBlank String code,
        @NotBlank String name,
        @JsonProperty("sort_order") Integer sortOrder,
        Boolean enabled) {
}
