package com.mis.taskflow.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 启动流程实例。
 *
 * @param startedFormCode 本次使用的表单代码，必须在定义白名单内
 */
public record StartProcessRequest(
        @NotBlank String definitionCode,
        @NotBlank String businessType,
        @NotBlank String businessId,
        @NotBlank String startedFormCode,
        String formData,
        Long initiatorId,
        String initiatorName
) {
}
