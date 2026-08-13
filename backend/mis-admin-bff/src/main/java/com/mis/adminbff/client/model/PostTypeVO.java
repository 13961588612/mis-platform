package com.mis.adminbff.client.model;

/**
 * 岗位类型 VO（BFF 透传 mis-org PostTypeVO）。
 */
public record PostTypeVO(
        String id,
        String tenantId,
        String code,
        String name,
        Integer sort,
        Integer status,
        Integer referenceCount
) {}
