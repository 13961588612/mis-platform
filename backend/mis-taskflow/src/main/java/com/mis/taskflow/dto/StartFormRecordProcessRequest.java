package com.mis.taskflow.dto;

import jakarta.validation.constraints.NotBlank;

import java.time.LocalDateTime;

/**
 * 从已保存单据发起本地流程。
 */
public record StartFormRecordProcessRequest(
        @NotBlank String definitionCode,
        String businessId,
        String title,
        Short priority,
        LocalDateTime dueDate,
        Long initiatorId,
        String initiatorName,
        String initiatorOrgName,
        String appCode
) {
}
