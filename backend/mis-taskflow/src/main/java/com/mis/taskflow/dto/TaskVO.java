package com.mis.taskflow.dto;

import java.time.LocalDateTime;

/**
 * 代办任务视图。
 *
 * @param appCode          应用归属（{@code sys_app.code}）；{@code null} = 平台级
 * @param initiatorName    关联流程实例发起人（无实例则 {@code null}）
 * @param initiatorOrgName 发起人所属组织/公司名快照（无则 {@code null}）
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
        String appCode,
        String initiatorName,
        String initiatorOrgName
) {
}