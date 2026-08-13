package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record DeptCreateRequest(
        @NotNull Long orgId,
        @NotNull Long parentId,
        @NotBlank String name,
        @NotNull Long categoryId,
        /** V40 新增：手工对应组织（穿透锚点，NULL=无） */
        Long linkedOrgId,
        Integer sort,
        Long leaderEmployeeId
) {}
