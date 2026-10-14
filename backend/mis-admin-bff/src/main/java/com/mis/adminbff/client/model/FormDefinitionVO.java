package com.mis.adminbff.client.model;

import java.time.LocalDateTime;

/**
 * 业务表单注册项（透传 mis-taskflow 的 FormDefinitionVO）。
 *
 * <p>V149：工作流关联字段（NONE/LOCAL/EXTERNAL）一并透传。
 */
public record FormDefinitionVO(
        String id,
        String tenantId,
        Long categoryId,
        String code,
        String name,
        String description,
        String status,
        Integer sortOrder,
        String config,
        String workflowBindingType,
        String workflowDefinitionId,
        String externalWorkflowSystem,
        String externalWorkflowRef,
        LocalDateTime createdAt,
        LocalDateTime updatedAt) {
}
