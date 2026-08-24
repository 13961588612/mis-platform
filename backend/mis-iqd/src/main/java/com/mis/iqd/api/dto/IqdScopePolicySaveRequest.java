package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 范围策略保存请求（POST /api/v1/iqd/scope/policies；snake_case wire）。
 *
 * @param subjectType global|role|dept|user|store
 * @param subjectId   主体 id（global 时固定 "global"；角色码/部门 id/用户 id/门店编码）
 * @param itemKey     表/语义键
 * @param allow       是否允许（true=纳入范围）
 * @param effective   是否生效
 * @param remark      备注
 */
public record IqdScopePolicySaveRequest(
        @JsonProperty("subject_type") String subjectType,
        @JsonProperty("subject_id") String subjectId,
        @JsonProperty("item_key") String itemKey,
        Boolean allow,
        Boolean effective,
        String remark) {
}
