package com.mis.iam.dto;

import java.util.List;

/** 供 mis-auth 登录/刷新的内部载荷（含 passwordHash）。 */
public record AuthUserVO(
        String id,
        String tenantId,
        String appId,
        String employeeId,
        String username,
        String passwordHash,
        Integer status,
        Integer isTenantAdmin,
        Integer mustChangePassword,
        Long permVersion,
        List<String> roleCodes,
        String realName,
        String deptId
) {}
