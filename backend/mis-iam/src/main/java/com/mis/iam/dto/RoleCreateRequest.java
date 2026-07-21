package com.mis.iam.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record RoleCreateRequest(
        @NotNull Long tenantId,
        @NotNull Long appId,
        @NotBlank String code,
        @NotBlank String name,
        Integer dataScope,
        String remark
) {}
