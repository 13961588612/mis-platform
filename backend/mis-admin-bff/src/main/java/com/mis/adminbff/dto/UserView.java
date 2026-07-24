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
        Instant createdAt
) {
    public record RoleBrief(String id, String name, String code) {}
}
