package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * BFF 系统参数创建请求（对齐 mis-system ConfigCreateRequest）。
 */
public record ConfigCreateRequest(
        @NotBlank String configKey,
        @NotBlank String configValue,
        String remark
) {}
