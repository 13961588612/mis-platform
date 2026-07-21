package com.mis.org.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record OrgCreateRequest(
        @NotNull Long tenantId,
        @NotBlank String code,
        @NotBlank String name,
        Integer sort,
        String remark,
        /** 根部门类别；为空则取租户 headquarters 或首个启用类别 */
        Long categoryId
) {}
