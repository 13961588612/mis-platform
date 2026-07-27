package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;

public record ModuleApiUpdateRequest(
        Long parentId,
        @NotBlank String code,
        @NotBlank String type,
        @NotBlank String name,
        String httpMethod,
        String pathPattern,
        Integer sort,
        Integer status
) {}
