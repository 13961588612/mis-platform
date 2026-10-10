package com.mis.adminbff.client.model;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 表单分类项（透传 mis-taskflow 的 FormCategoryVO）。
 *
 * @param children 子节点，仅树接口填充
 */
public record FormCategoryVO(
        String id,
        String tenantId,
        Long parentId,
        String code,
        String name,
        String description,
        Integer sortOrder,
        String config,
        List<FormCategoryVO> children,
        LocalDateTime createdAt,
        LocalDateTime updatedAt) {
}
