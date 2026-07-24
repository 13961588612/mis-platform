package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;

public record RoleCreateRequest(
        @NotBlank String code,
        @NotBlank String name,
        Integer dataScope,
        String remark
) {}
