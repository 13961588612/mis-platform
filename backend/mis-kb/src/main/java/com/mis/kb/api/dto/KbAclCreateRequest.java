package com.mis.kb.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/** ACL 授权创建请求（libraryId 取路径参数）。 */
public record KbAclCreateRequest(
        @NotNull Long subjectId,
        @NotBlank String subjectType,
        @NotBlank String action) {
}
