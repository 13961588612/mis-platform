package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record ModuleApiCreateRequest(
        @NotNull Long moduleId,
        Long parentId,
        @NotBlank String code,
        @NotBlank String type,
        @NotBlank String name,
        String httpMethod,
        String pathPattern,
        Integer sort,
        Integer status
) {}
