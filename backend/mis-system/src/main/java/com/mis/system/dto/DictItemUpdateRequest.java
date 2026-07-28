package com.mis.system.dto;

import jakarta.validation.constraints.NotBlank;

public record DictItemUpdateRequest(
        @NotBlank String label,
        @NotBlank String value,
        Integer sort,
        Integer status,
        String cssClass
) {}
