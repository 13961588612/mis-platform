package com.mis.system.dto;

import com.mis.system.domain.entity.SysApi.ApiNodeType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record ApiCreateRequest(
        @NotNull Long moduleId,
        Long parentId,
        @NotBlank String code,
        @NotNull ApiNodeType type,
        @NotBlank String name,
        String httpMethod,
        String pathPattern,
        Integer sort,
        Integer status
) {}
