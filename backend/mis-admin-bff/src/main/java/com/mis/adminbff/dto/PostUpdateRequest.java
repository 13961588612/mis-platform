package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * BFF 岗位更新请求（对齐 mis-org PostUpdateRequest）。
 */
public record PostUpdateRequest(
        @NotNull Long deptId,
        @NotNull Long postTypeId,
        @NotBlank String code,
        @NotBlank String name,
        Integer sort,
        Integer status
) {}
