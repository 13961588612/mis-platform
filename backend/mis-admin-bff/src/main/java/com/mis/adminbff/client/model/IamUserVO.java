package com.mis.adminbff.client.model;

import java.time.Instant;
import java.util.List;

/** 对齐 mis-iam UserVO JSON。 */
public record IamUserVO(
        String id,
        String tenantId,
        String appId,
        String employeeId,
        String username,
        String avatarUrl,
        Integer status,
        Integer isTenantAdmin,
        Integer mustChangePassword,
        String realName,
        String deptId,
        List<IamRoleVO> roles,
        Instant createdAt,
        Instant updatedAt
) {}
