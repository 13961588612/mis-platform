package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;

public record DeptUpdateRequest(
        @NotBlank String name,
        Long categoryId,
        Integer sort,
        Integer status,
        Long leaderEmployeeId,
        Long parentId,
        /** V40 新增：手工对应组织（穿透锚点）；PUT 总是下发，null=清空 */
        Long linkedOrgId
) {}
