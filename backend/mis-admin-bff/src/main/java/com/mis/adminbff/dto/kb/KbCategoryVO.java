package com.mis.adminbff.dto.kb;

import java.time.Instant;

/** 知识库分类视图（BFF 侧镜像）。 */
public record KbCategoryVO(
        Long id,
        Long parentId,
        String name,
        Integer enabled,
        Integer sort,
        String remark,
        Instant createdAt,
        Instant updatedAt) {
}
