package com.mis.adminbff.dto.iqd;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 范围裁定结果（与 Python {@code models/iqd_schema.py::ScopeResolutionPayload} 同构，§4.3）。
 *
 * @param decision         allowed / denied / partial
 * @param allowedItemKeys  允许条目键列表
 * @param deniedItemKeys   拒绝条目键列表
 * @param reason           裁定原因（可空）
 * @param subjectSummary   主体摘要（身份维度回显；可空）
 */
public record IqdScopeResolutionPayload(
        String decision,
        @JsonProperty("allowed_item_keys") java.util.List<String> allowedItemKeys,
        @JsonProperty("denied_item_keys") java.util.List<String> deniedItemKeys,
        String reason,
        @JsonProperty("subject_summary") String subjectSummary) {
}
