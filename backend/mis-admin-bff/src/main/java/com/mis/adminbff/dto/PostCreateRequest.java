package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * BFF 岗位创建请求（对齐 mis-org PostCreateRequest）。
 */
public record PostCreateRequest(
        @NotNull Long deptId,
        @NotNull Long postTypeId,
        @NotBlank String code,
        @NotBlank String name,
        Integer sort,
        Integer status,
        Integer quota
) {}
