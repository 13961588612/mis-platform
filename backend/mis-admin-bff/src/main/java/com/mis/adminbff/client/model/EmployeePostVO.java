package com.mis.adminbff.client.model;

/**
 * 员工任职岗位明细（BFF 透传 mis-org EmployeePostVO）。
 */
public record EmployeePostVO(
        String postId,
        String postName,
        String deptId,
        String deptName,
        Integer isPrimary,
        Integer status,
        String startDate
) {}
