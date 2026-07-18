package com.mis.iam.dto;

import java.time.Instant;
import java.util.List;

public record UserVO(
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
        List<String> roles,
        Instant createdAt,
        Instant updatedAt
) {}
