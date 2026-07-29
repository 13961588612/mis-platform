package com.mis.iam.dto;

import jakarta.validation.constraints.NotBlank;

import java.util.List;

public record UserUpdateRequest(
        @NotBlank String username,
        Integer status,
        /** 关联组织列表（含主组织），首项为主组织 */
        List<Long> orgIds,
        /** 关联部门列表（含主部门），首项为主部门 */
        List<Long> deptIds
) {}
