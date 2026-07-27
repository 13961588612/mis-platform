package com.mis.adminbff.dto;

import java.time.Instant;

public record ModuleVO(
        String id,
        String code,
        String name,
        String serviceName,
        Integer sort,
        Integer status,
        Instant createdAt,
        Instant updatedAt
) {}
