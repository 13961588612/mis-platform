package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;

import java.util.List;

public record UserUpdateRequest(
        @NotBlank String username,
        /** 绑定员工 ID：提供且与现有不同表示绑定/换绑；显式 null 表示解绑（Req2） */
        Long employeeId,
        String realName,
        String email,
        String phone,
        Integer status,
        /** 归属组织（含主组织），首项主组织 */
        List<Long> orgIds,
        /** 归属部门（含主部门），首项主部门 */
        List<Long> deptIds
) {}
