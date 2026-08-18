package com.mis.iam.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.List;

/**
 * 创建用户（双模式）：
 * <ul>
 *   <li>绑员工：提供 {@code employeeId}；realName/phone/orgIds/deptIds 可省略（由员工同步/派生）</li>
 *   <li>非员工：{@code employeeId} 为 null；realName/phone/orgIds/deptIds 自行提供（组织/部门可空）</li>
 * </ul>
 */
public record UserCreateRequest(
        @NotNull Long tenantId,
        @NotNull Long appId,
        /** 绑定的员工 ID；非员工用户传 null */
        Long employeeId,
        @NotBlank String username,
        @NotBlank String password,
        /** 姓名：非员工用户必填；绑员工时可省略（派生于员工） */
        String realName,
        String phone,
        /** 归属组织（非员工用户可选；绑员工时可由员工主部门派生） */
        List<Long> orgIds,
        /** 归属部门（非员工用户可选；绑员工时可由员工主部门派生） */
        List<Long> deptIds,
        List<Long> roleIds
) {}
