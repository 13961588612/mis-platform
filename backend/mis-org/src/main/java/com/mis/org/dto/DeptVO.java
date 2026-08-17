package com.mis.org.dto;

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
        /** V40 新增：手工对应组织（穿透锚点，NULL=无） */
        String linkedOrgId,
        /** V40 新增：锚点组织名（供「下钻」按钮） */
        String linkedOrgName,
        /** V54 新增：部门类型 id（NULL=未设置） */
        String deptTypeId,
        /** V54 新增：部门类型名（由 sys_dept_type 解析，NULL=未知） */
        String deptTypeName,
        /** V54 新增：部门编制数 / headcount 配额（NULL=0） */
        Integer establishmentCount,
        /** V54 新增：是否末级（1=末级 / 0=非末级；后端按「有无子部门」计算） */
        Integer isLeaf,
        Instant createdAt,
        Instant updatedAt,
        List<DeptVO> children
) {}
