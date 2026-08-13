package com.mis.adminbff.client.model;

import java.util.List;

/**
 * 组织穿透树节点 VO（BFF 透传 mis-org DeptPierceVO，字段一一对应）。
 */
public record DeptPierceVO(
        String id,
        String orgId,
        String orgName,
        String parentId,
        String code,
        String name,
        Integer sort,
        Integer status,
        Integer isRoot,
        String linkedOrgId,
        String linkedOrgName,
        List<DeptPierceVO> children
) {}
