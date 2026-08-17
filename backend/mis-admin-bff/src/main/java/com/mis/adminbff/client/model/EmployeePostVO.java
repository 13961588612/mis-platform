package com.mis.adminbff.client.model;

/**
 * 员工任职岗位明细（BFF 透传 mis-org EmployeePostVO）。
 * V54 新增 orgName（该任职部门所属组织名）。
 */
public record EmployeePostVO(
        String postId,
        String postName,
        String deptId,
        String deptName,
        /** V54 该任职部门所属组织名（脏数据/未挂载组织时为 null） */
        String orgName,
        Integer isPrimary,
        Integer status,
        String startDate
) {}
