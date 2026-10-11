package com.mis.taskflow.dto;

import java.time.LocalDateTime;

/**
 * 代办任务视图。
 *
 * @param appCode 应用归属（{@code sys_app.code}）；{@code null} = 平台级
 */
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