package com.mis.adminbff.dto;

import java.time.Instant;
import java.util.List;

public record UserView(
        String id,
        String username,
        String realName,
        String employeeNo,
        String employeeId,
        String deptId,
        String deptName,
        String orgId,
        String orgName,
        String email,
        String phone,
        Integer status,
        Integer isTenantAdmin,
        List<RoleBrief> roles,
        Instant createdAt,
        /** 所属 APP id（显式归属，D1/D2） */
        String appId,
        /**
         * 组织权限（数据范围）id 列表；与列表展示用 {@code orgId} 解耦。
         * 权限 Sheet 回填必须用此字段，不能回退到员工主组织。
         */
        List<String> orgIds,
        /**
         * 部门权限（数据范围）id 列表；与列表展示用 {@code deptId} 解耦。
         * 权限 Sheet 回填必须用此字段，不能回退到员工主部门。
         */
        List<String> deptIds
) {
    public record RoleBrief(String id, String name, String code) {}
}
