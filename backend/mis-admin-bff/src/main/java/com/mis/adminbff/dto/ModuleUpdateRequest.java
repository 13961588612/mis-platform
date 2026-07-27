package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;

public record ModuleUpdateRequest(
        @NotBlank String name,
        @NotBlank String serviceName,
        Integer sort,
        Integer status
) {}
