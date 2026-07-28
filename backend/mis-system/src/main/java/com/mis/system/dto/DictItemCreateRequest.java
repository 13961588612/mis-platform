package com.mis.system.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record DictItemCreateRequest(
        @NotNull Long typeId,
        @NotBlank String label,
        @NotBlank String value,
        Integer sort,
        String cssClass
) {}
