package com.mis.taskflow.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 创建代办请求（可同时生成关联通知消息）。
 *
 * @param notifyTitle  非空时自动创建一条关联通知消息
 * @param notifySummary 通知摘要
 * @param metadata     可选 JSON 字符串
 */
public record CreateTaskRequest(
        @NotBlank String taskType,
        @NotBlank String bizType,
        @NotBlank String bizRefId,
        @NotBlank String bizTitle,
        String targetEntity,
        @NotNull Long assigneeId,
        String assigneeName,
        Short priority,
        LocalDateTime dueDate,
        String metadata,
        String notifyTitle,
        String notifySummary
) {
}