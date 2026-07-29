package com.mis.org.dto;

import jakarta.validation.constraints.NotBlank;

import java.time.LocalDate;
import java.util.List;

public record EmployeeUpdateRequest(
        @NotBlank String realName,
        String email,
        String phone,
        Integer gender,
        String title,
        /** 主部门（兼容旧字段） */
        Long deptId,
        /** 任职部门列表（含主部门），首项为主部门 */
        List<Long> deptIds,
        /** 任职岗位列表 */
        List<EmployeePostItem> posts,
        LocalDate hireDate,
        Integer status
) {}
