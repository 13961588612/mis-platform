package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record MenuCreateRequest(
        @NotNull Long parentId,
        @NotBlank String name,
        @NotNull Integer type,
        String path,
        String component,
        String permission,
        String icon,
        Integer sort,
        Integer visible
) {}
