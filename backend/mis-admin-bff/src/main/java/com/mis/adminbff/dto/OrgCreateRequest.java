package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;

public record OrgCreateRequest(
        @NotBlank String code,
        @NotBlank String name,
        /** V40 新增：上级组织（0=顶级；null 视为顶级） */
        Long parentId,
        Integer sort,
        String remark,
        Long categoryId
) {}
