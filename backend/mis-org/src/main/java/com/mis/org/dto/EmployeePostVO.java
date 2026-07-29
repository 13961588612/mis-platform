package com.mis.org.dto;

/**
 * 员工任职岗位明细（含岗位名、所属部门、是否主岗）。
 */
public record EmployeePostVO(
        String postId,
        String postName,
        String deptId,
        String deptName,
        Integer isPrimary,
        Integer status
) {}
