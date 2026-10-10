package com.mis.taskflow.dto;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 流程分类项（对外 VO）。
 *
 * @param id           主键
 * @param tenantId     租户
 * @param parentId     父分类，0=根
 * @param code         分类编码（租户内唯一）
 * @param name         中文名
 * @param description  说明
 * @param sortOrder    同级排序
 * @param config       预留 JSON
 * @param children     子节点（仅树接口填充，列表接口为 null）
 * @param createdAt    创建时间
 * @param updatedAt    更新时间
 */
public record WfCategoryVO(
        String id,
        String tenantId,
        Long parentId,
        String code,
        String name,
        String description,
        Integer sortOrder,
        String config,
        List<WfCategoryVO> children,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
}
