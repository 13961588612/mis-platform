package com.mis.adminbff.dto.kb;

import java.time.Instant;

/**
 * KBP-10 存量 manage/acl 授权清单视图（BFF 侧镜像，只读运营清理依据）。
 *
 * <p><b>{@code subjectName} 由 BFF 通过 {@code KbSubjectProxyService} 批量回填</b>
 * （mis-kb 返回时恒为 {@code null}，与 {@code KbAclSummaryVO} 现有回填口径一致）；
 * 回填失败时保持 {@code null}，前端降级展示 {@code subjectType + subjectId}——
 * 不能因为名字查不到就让整个清单打不开。
 *
 * @param id          授权行 id
 * @param libraryId   知识库 id
 * @param libraryName 知识库名（mis-kb 关联 {@code kb_library} 回填；库已删除时为 {@code null}）
 * @param categoryId  知识库所属分类 id（库已删除时为 {@code null}）
 * @param subjectType 主体类型 user/role/dept
 * @param subjectId   主体 id
 * @param subjectName 主体名称（BFF 回填）
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
