package com.mis.taskflow.dto;

import java.time.LocalDateTime;

public record AuditOpDetailVO(
        String id,
        String userId,
        String username,
        String module,
        String operationType,
        String businessType,
        String businessId,
        String description,
        String beforeData,
        String afterData,
        String diffSummary,
        String traceId,
        String resultStatus,
        String errorMsg,
        Integer durationMs,
        String extraContext,
        LocalDateTime operTime
) {
}