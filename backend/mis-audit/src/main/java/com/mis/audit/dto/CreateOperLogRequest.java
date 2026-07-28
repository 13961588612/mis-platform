package com.mis.audit.dto;

import jakarta.validation.constraints.NotNull;

public record CreateOperLogRequest(
        @NotNull Long tenantId,
        Long userId,
        String username,
        String module,
        String operation,
        String method,
        String requestUri,
        String requestMethod,
        String requestParams,
        Integer responseCode,
        Integer durationMs,
        String ip
) {}
