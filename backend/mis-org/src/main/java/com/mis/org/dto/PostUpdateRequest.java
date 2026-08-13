package com.mis.org.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * 岗位更新请求。
 */
public record PostUpdateRequest(
        @NotNull Long deptId,
        @NotNull Long postTypeId,
        @NotBlank String code,
        @NotBlank String name,
        Integer sort,
        Integer status
) {}
