package com.mis.taskflow.dto;

import java.time.LocalDateTime;

/**
 * 业务表单注册项（对外 VO）。
 *
 * <p>V133 起分类是表单的<b>属性</b>：{@code categoryId} 软引用 {@code form_category.id}，
 * {@code null} 表示「未分类」。旧模型里的 {@code parentId} / {@code kind} / {@code children}
 * 已随分类拆表一并移除。
 *
 * @param id           主键
 * @param tenantId     租户
 * @param categoryId   所属分类 id（软引用 form_category.id；null=未分类）
 * @param code         表单编码（= 前端注册表 key）
 * @param name         中文名
 * @param description  说明
 * @param status       ENABLED / DISABLED
 * @param sortOrder    排序
 * @param config       预留 JSON
 * @param createdAt    创建时间
 * @param updatedAt    更新时间
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
        LocalDateTime updatedAt
) {
}
