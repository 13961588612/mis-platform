package com.mis.org.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;

public record EmployeeCreateRequest(
        @NotNull Long tenantId,
        @NotNull Long deptId,
        @NotBlank String employeeNo,
        @NotBlank String realName,
        String email,
        String phone,
        Integer gender,
        String title,
        LocalDate hireDate
) {}
