package com.mis.org.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;
import java.util.List;

public record EmployeeCreateRequest(
        @NotNull Long tenantId,
        /** 主部门（兼容旧字段，等于 deptIds 首项） */
        @NotNull Long deptId,
        /** 任职部门列表（含主部门），首项为主部门 */
        List<Long> deptIds,
        @NotBlank String employeeNo,
        @NotBlank String realName,
        String email,
        String phone,
        Integer gender,
        String title,
        LocalDate hireDate,
        /** 任职岗位列表，首项或 isPrimary=1 的为主岗 */
        List<EmployeePostItem> posts
) {}
