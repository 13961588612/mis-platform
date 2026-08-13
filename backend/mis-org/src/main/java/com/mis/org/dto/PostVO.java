package com.mis.org.dto;

/**
 * 岗位展示 VO（含所属部门名、岗位类型名）。
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
        Integer status
) {}
