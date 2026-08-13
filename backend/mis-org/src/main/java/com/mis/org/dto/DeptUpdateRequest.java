package com.mis.org.dto;

import jakarta.validation.constraints.NotBlank;

public record DeptUpdateRequest(
        @NotBlank String name,
        Long categoryId,
        Long parentId,
        Integer sort,
        Integer status,
        Long leaderEmployeeId,
        /** V40 新增：手工对应组织（穿透锚点）；PUT 总是下发，null=清空 */
        Long linkedOrgId
) {}
