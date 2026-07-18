package com.mis.org.dto;

import java.time.Instant;
import java.time.LocalDate;

public record EmployeeVO(
        String id,
        String tenantId,
        String deptId,
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
