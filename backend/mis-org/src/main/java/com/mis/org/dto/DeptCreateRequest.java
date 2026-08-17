package com.mis.org.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record DeptCreateRequest(
        @NotNull Long tenantId,
        @NotNull Long orgId,
        @NotNull Long parentId,
        @NotBlank String name,
        @NotNull Long categoryId,
        /** V40 新增：手工对应组织（穿透锚点，NULL=无） */
        Long linkedOrgId,
        Integer sort,
        Long leaderEmployeeId,
        /** V54 新增：部门类型 id（应用层必填，逻辑关联 sys_dept_type.id） */
        @NotNull Long deptTypeId,
        /** V54 新增：部门编制数 / headcount 配额（NULL=0） */
        Integer establishmentCount
) {}
