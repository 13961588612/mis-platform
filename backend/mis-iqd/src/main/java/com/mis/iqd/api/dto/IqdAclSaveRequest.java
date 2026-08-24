package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 表级 ACL 保存请求（POST /api/v1/iqd/acl/batch；snake_case wire）。
 *
 * @param subjectType role|dept|user|store
 * @param subjectId   角色码/部门 id/用户 id/门店编码
 * @param itemKey     表 item_key（{datasource}.{schema}.{table}）
 * @param action      ask | manage
 * @param rowScope    JSONB 字符串（行级范围；null=全行可见）
 */
public record IqdAclSaveRequest(
        @JsonProperty("subject_type") String subjectType,
        @JsonProperty("subject_id") String subjectId,
        @JsonProperty("item_key") String itemKey,
        String action,
        @JsonProperty("row_scope") String rowScope) {
}
