package com.mis.adminbff.client.model;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

public record EmployeeVO(
        String id,
        String tenantId,
        String deptId,
        List<String> deptIds,
        String primaryDeptId,
        /** V54 主部门所属组织名（由 emp.deptId → dept → org 解析；脏数据/未挂载组织时为 null） */
        String orgName,
        List<EmployeePostVO> posts,
        String employeeNo,
        String realName,
        String email,
        String phone,
        Integer gender,
        String title,
        LocalDate hireDate,
        Integer status,
        Instant createdAt,
        Instant updatedAt
) {}
