package com.mis.system.dto;

import jakarta.validation.constraints.NotBlank;

public record DictTypeCreateRequest(
        @NotBlank String code,
        @NotBlank String name,
        String remark,
        Long tenantId
) {}
