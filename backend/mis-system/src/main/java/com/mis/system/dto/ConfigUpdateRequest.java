package com.mis.system.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 系统参数更新请求（config_key 创建后不可变，仅改值/备注）。
 */
public record ConfigUpdateRequest(
        @NotBlank String configValue,
        String remark
) {}
