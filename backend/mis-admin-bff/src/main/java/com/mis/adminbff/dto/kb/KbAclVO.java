package com.mis.adminbff.dto.kb;

import java.time.Instant;

/**
 * 知识库 ACL 视图（BFF 侧镜像）。
 *
 * <p>{@code subjectName} 由 BFF 通过 {@code SubjectProxyService} 批量回填；
 * mis-kb 返回时该字段为 {@code null}。回填失败时保持 {@code null}，
 * 前端降级展示 {@code subjectType + subjectId}——不能因为名字查不到就让整个授权列表打不开。
 *
 * @param subjectType 主体类型 user/role/dept
 * @param subjectId   主体 id
 * @param action      权限动作 read/manage/acl
 * @param subjectName 主体名称（BFF 回填；可空，缺失/回填失败为 null）
 */
public record KbAclVO(
        Long id,
        Long libraryId,
        String subjectType,
        Long subjectId,
        String action,
        Instant createdAt,
        Instant updatedAt,
        String subjectName) {
}
