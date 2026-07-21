package com.mis.adminbff.client.model;

import java.time.Instant;
import java.util.List;

public record DeptVO(
        String id,
        String tenantId,
        String orgId,
        String parentId,
        String code,
        String name,
        String categoryId,
        String ancestors,
        Integer sort,
        Integer status,
        Integer isRoot,
        String leaderEmployeeId,
        Instant createdAt,
        Instant updatedAt,
        List<DeptVO> children
) {}
