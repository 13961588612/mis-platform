package com.mis.taskflow.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDateTime;

/**
 * 创建代办请求（可同时生成关联通知消息）。
 *
 * @param notifyTitle   非空时自动创建一条关联通知消息
 * @param notifySummary 通知摘要
 * @param metadata      可选 JSON 字符串
 * @param appCode       可选应用归属（{@code sys_app.code}）
 * @param instanceId    可选关联流程实例；非空时写入消息 {@code instance_id}，供消息抽屉打开流程
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
        String notifySummary,
        String appCode,
        Long instanceId
) {
    /** 兼容无 instanceId 的旧调用点。 */
    public CreateTaskRequest(String taskType, String bizType, String bizRefId, String bizTitle,
                             String targetEntity, Long assigneeId, String assigneeName,
                             Short priority, LocalDateTime dueDate, String metadata,
                             String notifyTitle, String notifySummary, String appCode) {
        this(taskType, bizType, bizRefId, bizTitle, targetEntity, assigneeId, assigneeName,
                priority, dueDate, metadata, notifyTitle, notifySummary, appCode, null);
    }
}
