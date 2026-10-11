package com.mis.adminbff.client.model;

import java.time.LocalDateTime;

/** 代办任务视图（BFF 透传 mis-taskflow）。 */
public record TaskVO(
        String id,
        String tenantId,
        String taskType,
        String bizType,
        String bizRefId,
        String bizTitle,
        String targetEntity,
        String assigneeId,
        String assigneeName,
        String status,
        Short priority,
        LocalDateTime dueDate,
        String metadata,
        String result,
        boolean read,
        LocalDateTime completedAt,
        LocalDateTime createdAt,
        String appCode
) {
}