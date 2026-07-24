package com.mis.adminbff.client.model;

import java.time.Instant;

public record IamRoleVO(
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
