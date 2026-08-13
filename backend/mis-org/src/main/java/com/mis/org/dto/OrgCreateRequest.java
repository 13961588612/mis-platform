package com.mis.org.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record OrgCreateRequest(
        @NotNull Long tenantId,
        @NotBlank String code,
        @NotBlank String name,
        /** V40 新增：上级组织（0=顶级；null 视为顶级） */
        Long parentId,
        Integer sort,
        String remark,
        /** 根部门类别；为空则取租户 headquarters 或首个启用类别 */
        Long categoryId
) {}
