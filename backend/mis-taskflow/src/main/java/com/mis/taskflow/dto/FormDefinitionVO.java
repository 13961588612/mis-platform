package com.mis.taskflow.dto;

import java.time.LocalDateTime;

/**
 * 业务表单注册项（对外 VO）。
 *
 * <p>V133 起分类是表单的<b>属性</b>：{@code categoryId} 软引用业务分类。
 * V149 起工作流关联落在本表：{@code workflowBindingType}=NONE/LOCAL/EXTERNAL。
 *
 * @param id                      主键
 * @param tenantId                租户
 * @param categoryId              所属分类 id（null=未分类）
 * @param code                    表单编码（= 前端注册表 key）
 * @param name                    中文名
 * @param description             说明
 * @param status                  ENABLED / DISABLED
 * @param sortOrder               排序
 * @param config                  预留 JSON
 * @param workflowBindingType     NONE / LOCAL / EXTERNAL
 * @param workflowDefinitionId    LOCAL 时本地流程定义 id
 * @param externalWorkflowSystem  EXTERNAL 时外部系统编码
 * @param externalWorkflowRef     EXTERNAL 时外部流程标识
 * @param createdAt               创建时间
 * @param updatedAt               更新时间
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
        LocalDateTime updatedAt
) {
}
