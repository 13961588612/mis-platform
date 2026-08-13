package com.mis.adminbff.client.model;

/**
 * 岗位 VO（BFF 透传 mis-org PostVO）。
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
