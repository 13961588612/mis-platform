package com.mis.adminbff.client.model;

import java.time.Instant;

public record OrgVO(
        String id,
        String tenantId,
        String code,
        String name,
        String parentId,
        Integer sort,
        Integer status,
        String remark,
        Integer isStore,
        String storeCode,
        String storeType,
        Instant createdAt,
        Instant updatedAt
) {}
