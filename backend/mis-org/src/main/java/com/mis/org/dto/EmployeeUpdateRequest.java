package com.mis.org.dto;

import jakarta.validation.constraints.NotBlank;

import java.time.LocalDate;

public record EmployeeUpdateRequest(
        @NotBlank String realName,
        String email,
        String phone,
        Integer gender,
        String title,
        Long deptId,
        LocalDate hireDate,
        Integer status
) {}
