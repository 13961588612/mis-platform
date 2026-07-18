package com.mis.org.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record OrgCreateRequest(
        @NotNull Long tenantId,
        @NotBlank String code,
        @NotBlank String name,
        Integer sort,
        String remark
) {}
