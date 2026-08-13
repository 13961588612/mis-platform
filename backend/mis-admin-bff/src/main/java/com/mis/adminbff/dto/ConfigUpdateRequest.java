package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * BFF 系统参数更新请求（对齐 mis-system ConfigUpdateRequest，config_key 不可变）。
 */
public record ConfigUpdateRequest(
        @NotBlank String configValue,
        String remark
) {}
