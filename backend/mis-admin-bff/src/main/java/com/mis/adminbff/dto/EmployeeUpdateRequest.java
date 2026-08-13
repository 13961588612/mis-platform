package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;

import java.time.LocalDate;
import java.util.List;

/**
 * BFF 员工更新请求（对齐 mis-org EmployeeUpdateRequest）。
 */
public record EmployeeUpdateRequest(
        @NotBlank String realName,
        String email,
        String phone,
        Integer gender,
        String title,
        Long deptId,
        List<Long> deptIds,
        List<EmployeeCreateRequest.EmployeePostItem> posts,
        LocalDate hireDate,
        Integer status
) {}
