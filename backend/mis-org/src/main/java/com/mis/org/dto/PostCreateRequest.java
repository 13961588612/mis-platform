package com.mis.org.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * 岗位创建请求。
 */
public record PostCreateRequest(
        @NotNull Long tenantId,
        @NotNull Long deptId,
        @NotNull Long postTypeId,
        @NotBlank String code,
        @NotBlank String name,
        Integer sort,
        Integer status,
        Integer quota
) {}
