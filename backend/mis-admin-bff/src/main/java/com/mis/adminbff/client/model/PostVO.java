package com.mis.adminbff.client.model;

/**
 * 岗位 VO（BFF 透传 mis-org PostVO）。
 *
 * <p>R7：与 mis-org PostVO 字段保持一致，补充 {@code orgId} / {@code orgName}（在 {@code quota} 之后）。
 * 字段名须与 mis-org 完全一致：orgId / orgName（勿用下划线）。
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
