package com.mis.audit.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record CreateLoginLogRequest(
        @NotNull Long tenantId,
        @NotNull Long appId,
        Long userId,
        @NotBlank String username,
        String ip,
        String userAgent,
        @NotNull Integer status,
        String msg
) {
}
