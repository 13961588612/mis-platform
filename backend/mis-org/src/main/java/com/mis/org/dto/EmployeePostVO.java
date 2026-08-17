package com.mis.org.dto;

/**
 * 员工任职岗位明细（含岗位名、所属部门、是否主岗、任职开始时间）。
 * V54 新增 orgName（该任职部门所属组织名，由 post.deptId → dept → org 解析）。
 */
public record EmployeePostVO(
        String postId,
        String postName,
        String deptId,
        String deptName,
        /** 该任职部门所属组织名（脏数据/未挂载组织时为 null） */
        String orgName,
        Integer isPrimary,
        Integer status,
        String startDate
) {}
