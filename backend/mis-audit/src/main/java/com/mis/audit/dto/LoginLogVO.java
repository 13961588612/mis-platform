package com.mis.audit.dto;

import java.time.Instant;

public record LoginLogVO(
        String id,
        String tenantId,
        String appId,
        String userId,
        String username,
        String ip,
        String userAgent,
        Integer status,
        String msg,
        Instant loginAt
) {
}
