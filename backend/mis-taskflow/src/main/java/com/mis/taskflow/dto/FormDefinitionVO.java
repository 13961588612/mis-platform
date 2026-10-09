package com.mis.taskflow.dto;

import java.time.LocalDateTime;

/**
 * 业务表单注册项（对外 VO）。
 *
 * @param id           主键
 * @param tenantId租户
 * @param parentId父分类，0=根
 * @param code         表单编码（= 前端注册表 key）
 * @param name         中文名
 * @param description说明
 * @param status       ENABLED / DISABLED
 * @param sortOrder    同级排序
 * @param config       预留 JSON
 * @param children     子节点（仅树接口填充，列表接口为 null）
 * @param createdAt    创建时间
 * @param updatedAt    更新时间
 */
public record FormDefinitionVO(
        String id,
        String tenantId,
        Long parentId,
        String code,
        String name,
        String description,
        String status,
        Integer sortOrder,
        String config,
        java.util.List<FormDefinitionVO> children,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
}