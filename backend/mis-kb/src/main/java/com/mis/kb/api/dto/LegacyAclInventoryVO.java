package com.mis.kb.api.dto;

import java.time.Instant;

/**
 * KBP-10 存量 manage/acl 授权清单视图（只读，运营清理依据）。
 *
 * <p><b>{@code subjectName} 恒为 {@code null}</b>（mis-kb 侧不解析主体名，由 BFF 用
 * {@code KbSubjectProxyService} 批量回填，与 {@code KbLibraryDetailVO.aclSummary}
 * 现有回填口径一致）。
 *
 * @param id          授权行 id
 * @param libraryId   知识库 id
 * @param libraryName 知识库名（关联 {@code kb_library} 回填；库已删除时为 {@code null}）
 * @param categoryId  知识库所属分类 id（库已删除时为 {@code null}）
 * @param subjectType 主体类型 user/role/dept
 * @param subjectId   主体 id
 * @param subjectName 主体名称（BFF 回填，mis-kb 侧恒为 {@code null}）
 * @param action      权限动作 manage/acl（存量零迁移行）
 * @param createdAt   创建时刻
 * @param updatedAt   更新时刻
 */
public record LegacyAclInventoryVO(
        Long id,
        Long libraryId,
        String libraryName,
        Long categoryId,
        String subjectType,
        Long subjectId,
        String subjectName,
        String action,
        Instant createdAt,
        Instant updatedAt) {
}
