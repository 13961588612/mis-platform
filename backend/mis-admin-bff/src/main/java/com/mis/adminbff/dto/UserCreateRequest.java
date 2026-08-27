package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;

import java.util.List;

/**
 * 创建用户（双模式）：绑员工传 {@code employeeId}；非员工传 null 且组织/部门可空。
 * 不再要求工号/部门必填（工号由员工模块归属，用户侧无需维护）。
 */
public record UserCreateRequest(
        @NotBlank String username,
        @NotBlank String realName,
        /** 绑定的员工 ID；非员工用户为 null */
        Long employeeId,
        String email,
        String phone,
        List<Long> roleIds,
        String password,
        /** 归属组织（非员工用户可选；绑员工时由 BFF 派生于员工主部门） */
        List<Long> orgIds,
        /** 归属部门（非员工用户可选；绑员工时由 BFF 派生于员工主部门） */
        List<Long> deptIds,
        /** 所属 APP：显式提交（不再取登录态上下文） */
        Long appId
) {}
