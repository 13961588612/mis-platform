package com.mis.iam.dto;

import jakarta.validation.constraints.NotBlank;

import java.util.List;

public record UserUpdateRequest(
        @NotBlank String username,
        Integer status,
        /**
         * 绑定员工 ID：提供且与现有 employeeId 不同表示绑定/换绑；显式置 null 表示解绑。
         * 绑定/换绑时姓名/手机/组织/部门均以员工资料为准（由 BFF 解析后回传），后端仅做防御。
         */
        Long employeeId,
        /**
         * 姓名：仅非员工用户可改；已绑定员工的用户禁止（改员工由 mis-org 同步回写）。
         * 后端在 UserService.update 中按 employeeId 是否为空做防御。
         */
        String realName,
        /** 手机号：仅非员工用户可改（同上） */
        String phone,
        /** 关联组织列表（含主组织），首项为主组织 */
        List<Long> orgIds,
        /** 关联部门列表（含主部门），首项为主部门 */
        List<Long> deptIds,
        /** 所属 APP：显式提交（不再取登录态）；与现有 appId 不同且已分配角色时触发守卫（D4） */
        Long appId,
        /** 用户级邮箱：非员工用户自行填写；绑员工时由员工邮箱同步回填（Q1 裁决） */
        String email
) {}
