package com.mis.adminbff.client.model;

import java.time.Instant;
import java.util.List;

public record DeptVO(
        String id,
        String tenantId,
        String orgId,
        String parentId,
        String code,
        String name,
        String categoryId,
        String ancestors,
        Integer sort,
        Integer status,
        Integer isRoot,
        String leaderEmployeeId,
        String linkedOrgId,
        String linkedOrgName,
        /** V54 新增：部门类型 id（NULL=未设置） */
        String deptTypeId,
        /** V54 新增：部门类型名（NULL=未知） */
        String deptTypeName,
        /** V54 新增：部门编制数 / headcount 配额（NULL=0） */
        Integer establishmentCount,
        /** V54 新增：是否末级（1=末级 / 0=非末级；后端按「有无子部门」计算） */
        Integer isLeaf,
        Instant createdAt,
        Instant updatedAt,
        List<DeptVO> children
) {}
