package com.mis.org.dto;

/**
 * 岗位展示 VO（含所属部门名、所属组织名、岗位类型名）。
 *
 * <p>R7：对称性补充 {@code orgId} / {@code orgName}（与 {@code deptId} / {@code deptName} 对应），
 * 由 PostService 在批量预取（R1）时一并填充；{@code orgName} 为 null 表示脏数据（部门未挂载组织）。
 */
public record PostVO(
        String id,
        String tenantId,
        String deptId,
        String deptName,
        String postTypeId,
        String postTypeName,
        String code,
        String name,
        Integer sort,
        Integer status,
        Integer quota,
        String orgId,
        String orgName
) {}
