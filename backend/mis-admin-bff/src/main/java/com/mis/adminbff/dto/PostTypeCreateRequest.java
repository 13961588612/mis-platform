package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * BFF 岗位类型创建请求（对齐 mis-org PostTypeCreateRequest）。
 */
public record PostTypeCreateRequest(
        @NotBlank String code,
        @NotBlank String name,
        Integer sort,
        Integer status
) {}
