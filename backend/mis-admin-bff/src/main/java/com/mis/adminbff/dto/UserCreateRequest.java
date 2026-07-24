package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.List;

/**
 * 创建用户：先建员工再建账号。{@code deptId} 为部门（非 api-spec 旧字段 orgId）。
 */
public record UserCreateRequest(
        @NotBlank String username,
        @NotBlank String realName,
        @NotNull Long deptId,
        @NotBlank String employeeNo,
        String email,
        String phone,
        List<Long> roleIds,
        String password
) {}
