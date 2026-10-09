package com.mis.taskflow.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 处理流程任务。
 *
 * @param action APPROVE / REJECT
 */
public record CompleteWfTaskRequest(
        @NotBlank String action,
        String comment
) {
}
