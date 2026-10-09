package com.mis.taskflow.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 转办代办。
 */
public record TransferTaskRequest(
        @NotNull Long newAssigneeId,
        String newAssigneeName,
        String comment
) {
}