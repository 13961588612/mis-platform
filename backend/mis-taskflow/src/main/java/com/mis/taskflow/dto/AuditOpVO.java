package com.mis.taskflow.dto;

import java.time.LocalDateTime;

public record AuditOpVO(
        String id,
        String userId,
        String username,
        String module,
        String operationType,
        String businessType,
        String businessId,
        String description,
        String resultStatus,
        Integer durationMs,
        LocalDateTime operTime
) {
}