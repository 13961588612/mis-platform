package com.mis.org.dto;

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
