package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 表级 ACL 保存请求（POST /api/v1/iqd/acl/batch；snake_case wire）。
 *
 * @param subjectType role|dept|user|store
 * @param subjectId   角色码/部门 id/用户 id/门店编码
 * @param objectType table | model | cube
 * @param objectKey  顶层对象 key（表/模型/Cube）
 * @param fieldKey   字段 key；null=对象级权限
 * @param itemKey    兼容字段：对象级=objectKey，字段级=fieldKey
 * @param action     固定 ask（保留字段兼容旧数据）
 * @param rowScope   JSONB 字符串（行级范围；null=全行可见）
 */
public record IqdAclSaveRequest(
        @JsonProperty("subject_type") String subjectType,
        @JsonProperty("subject_id") String subjectId,
        @JsonProperty("object_type") String objectType,
        @JsonProperty("object_key") String objectKey,
        @JsonProperty("field_key") String fieldKey,
        @JsonProperty("item_key") String itemKey,
        String action,
        @JsonProperty("row_scope") String rowScope) {
}
