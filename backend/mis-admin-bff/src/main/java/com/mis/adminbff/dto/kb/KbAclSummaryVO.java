package com.mis.adminbff.dto.kb;

/**
 * ACL 摘要（BFF 侧镜像）。
 *
 * <p>{@code subjectName} 由 BFF 通过 {@code SubjectProxyService} 批量回填；
 * mis-kb 返回时该字段为 {@code null}。回填失败时保持 {@code null}，
 * 前端降级展示 {@code subjectType + subjectId}——不能因为名字查不到就让整个授权列表打不开。
 *
 * @param subjectType 主体类型 user/role/dept
 * @param subjectId   主体 id
 * @param subjectName 主体名称（BFF 回填）
 * @param action      权限动作 read/manage/acl
 */
public record KbAclSummaryVO(
        String subjectType,
        Long subjectId,
        String subjectName,
        String action) {
}
