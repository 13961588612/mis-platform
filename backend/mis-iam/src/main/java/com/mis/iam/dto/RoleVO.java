package com.mis.iam.dto;

import java.time.Instant;

public record RoleVO(
        String id,
        String tenantId,
        String appId,
        String code,
        String name,
        Integer type,
        Integer dataScope,
        Integer status,
        String remark,
        Instant createdAt
) {}
