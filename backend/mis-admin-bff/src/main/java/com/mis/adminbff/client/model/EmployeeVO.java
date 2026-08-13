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
