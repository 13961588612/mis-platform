package com.mis.audit.dto;

import java.time.Instant;

public record OperLogVO(
        String id,
        String tenantId,
        String userId,
        String username,
        String module,
        String operation,
        String method,
        String requestUri,
        String requestMethod,
        Integer responseCode,
        Integer durationMs,
        String ip,
        String requestParams,
        Instant operTime
) {}
