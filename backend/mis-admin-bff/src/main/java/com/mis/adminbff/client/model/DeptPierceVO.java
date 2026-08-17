package com.mis.adminbff.client.model;

import java.util.List;

/**
 * 组织穿透树节点 VO（BFF 透传 mis-org DeptPierceVO，字段一一对应）。
 * V54 新增 deptTypeId / deptTypeName（部门类型，穿透只读行同样展示）。
 */
public record DeptPierceVO(
        String id,
        String orgId,
        String orgName,
        String parentId,
        String code,
        String name,
        /** V54 部门类型 id */
        String deptTypeId,
        /** V54 部门类型名 */
        String deptTypeName,
        Integer sort,
        Integer status,
        Integer isRoot,
        String linkedOrgId,
        String linkedOrgName,
        List<DeptPierceVO> children
) {}
