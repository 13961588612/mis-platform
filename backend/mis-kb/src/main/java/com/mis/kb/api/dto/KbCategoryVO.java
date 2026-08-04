package com.mis.kb.api.dto;

import java.time.Instant;

/** 分类视图对象。 */
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
