package com.mis.adminbff.client.model;

import java.time.LocalDateTime;

/**
 * 业务表单注册项（透传 mis-taskflow 的 FormDefinitionVO）。
 *
 * <p>V133 起分类是表单的属性：{@code categoryId} 软引用 {@code form_category.id}
 * （{@code null}=未分类）。旧的 {@code parentId} / {@code kind} / {@code children} 已移除。
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
        LocalDateTime createdAt,
        LocalDateTime updatedAt) {
}
