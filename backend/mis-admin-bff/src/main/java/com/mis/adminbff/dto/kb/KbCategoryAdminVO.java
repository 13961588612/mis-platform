package com.mis.adminbff.dto.kb;

import java.time.Instant;

/**
 * 分类节点管理员授权视图（BFF 侧镜像，纯透传）。
 *
 * @param id          授权行 id
 * @param categoryId  被授权节点 id（管理范围 = 该节点子树）
 * @param subjectType 主体类型 user/role/dept
 * @param subjectId   主体 id
 * @param createdBy   授权创建人用户 id（O-2，可空）
 * @param createdAt   创建时间
 * @param updatedAt   更新时间
 */
public record KbCategoryAdminVO(
        Long id,
        Long categoryId,
        String subjectType,
        Long subjectId,
        Long createdBy,
        Instant createdAt,
        Instant updatedAt) {
}
