package com.mis.system.dto;

import jakarta.validation.constraints.NotBlank;

public record MenuUpdateRequest(
        @NotBlank String name,
        String path,
        String component,
        String permission,
        String icon,
        Integer sort,
        Integer visible,
        Integer status
) {}
