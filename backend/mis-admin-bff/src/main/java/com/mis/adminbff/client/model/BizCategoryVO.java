package com.mis.adminbff.client.model;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 业务分类项（透传 mis-taskflow 的 BizCategoryVO）。
 *
 * @param children 子节点，仅树接口填充
 */
public record BizCategoryVO(
        String id,
        String tenantId,
        Long parentId,
        String code,
        String name,
        String description,
        Integer sortOrder,
        String config,
        List<BizCategoryVO> children,
        LocalDateTime createdAt,
        LocalDateTime updatedAt) {
}
