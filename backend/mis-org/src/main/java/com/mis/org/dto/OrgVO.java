package com.mis.org.dto;

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
        /** 门店类型：BGMD/CSMD/WLZS */
        String storeType,
        Instant createdAt,
        Instant updatedAt
) {}
