package com.mis.adminbff.client.model;

/**
 * 部门类型 VO（BFF 透传 mis-org DeptTypeVO）。
 */
public record DeptTypeVO(
        String id,
        String tenantId,
        String code,
        String name,
        Integer sort,
        Integer status,
        Integer referenceCount,
        String parentId,
        Integer isLeaf
) {}
