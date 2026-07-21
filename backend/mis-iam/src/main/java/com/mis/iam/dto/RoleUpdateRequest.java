package com.mis.iam.dto;

import jakarta.validation.constraints.NotBlank;

public record RoleUpdateRequest(
        @NotBlank String name,
        Integer dataScope,
        Integer status,
        String remark
) {}
