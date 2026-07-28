package com.mis.system.dto;

import jakarta.validation.constraints.NotBlank;

public record DictTypeUpdateRequest(
        @NotBlank String name,
        Integer status,
        String remark
) {}
