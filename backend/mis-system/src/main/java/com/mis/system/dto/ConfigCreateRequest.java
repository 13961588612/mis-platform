package com.mis.system.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 系统参数创建请求。
 */
public record ConfigCreateRequest(
        @NotBlank String configKey,
        @NotBlank String configValue,
        String remark
) {}
