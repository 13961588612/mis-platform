package com.mis.taskflow.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;

/**
 * 批量处理代办（同一 action）。
 */
public record BatchHandleTaskRequest(
        @NotEmpty List<Long> taskIds,
        @NotBlank String action,
        String comment
) {
}