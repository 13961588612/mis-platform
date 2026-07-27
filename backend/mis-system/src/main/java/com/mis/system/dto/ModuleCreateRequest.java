package com.mis.system.dto;

import jakarta.validation.constraints.NotBlank;

public record ModuleCreateRequest(
        @NotBlank String code,
        @NotBlank String name,
        @NotBlank String serviceName,
        Integer sort
) {}
