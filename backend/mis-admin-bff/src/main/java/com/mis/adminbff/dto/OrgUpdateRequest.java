package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;

public record OrgUpdateRequest(
        @NotBlank String name,
        /** V40 新增：上级组织（0=顶级；null 视为不变） */
        Long parentId,
        Integer sort,
        Integer status,
        String remark
) {}
