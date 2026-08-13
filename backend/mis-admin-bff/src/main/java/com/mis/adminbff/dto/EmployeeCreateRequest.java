package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;
import java.util.List;

/**
 * BFF 员工创建请求（对齐 mis-org EmployeeCreateRequest：deptId 主部门 + deptIds 多部门 + posts 多岗位）。
 */
public record EmployeeCreateRequest(
        @NotNull Long deptId,
        List<Long> deptIds,
        @NotBlank String employeeNo,
        @NotBlank String realName,
        String email,
        String phone,
        Integer gender,
        String title,
        LocalDate hireDate,
        List<EmployeePostItem> posts
) {
    /** 单个岗位任职项（postId + 是否主岗 + 任职开始时间） */
    public record EmployeePostItem(Long postId, Integer isPrimary, LocalDate startDate) {}
}
