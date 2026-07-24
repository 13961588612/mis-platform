package com.mis.adminbff.client.model;

import java.time.Instant;

public record OrgVO(
        String id,
        String tenantId,
        String code,
        String name,
        Integer sort,
        Integer status,
        String remark,
        Instant createdAt,
        Instant updatedAt
) {}
