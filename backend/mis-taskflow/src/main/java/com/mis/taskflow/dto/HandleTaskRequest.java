package com.mis.taskflow.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 处理代办。
 *
 * @param action  APPROVE / REJECT / COMPLETE
 * @param comment 审批意见
 * @param result  可选 JSON 结果
 */
public record HandleTaskRequest(
        @NotBlank String action,
        String comment,
        String result
) {
}