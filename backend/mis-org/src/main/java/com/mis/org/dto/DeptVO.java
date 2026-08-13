package com.mis.org.dto;

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
        /** V40 新增：手工对应组织（穿透锚点，NULL=无） */
        String linkedOrgId,
        /** V40 新增：锚点组织名（供「下钻」按钮） */
        String linkedOrgName,
        Instant createdAt,
        Instant updatedAt,
        List<DeptVO> children
) {}
