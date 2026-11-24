package com.mis.adminbff.dto;

public record AppUpdateRequest(
        String name,
        String icon,
        String basePath,
        String entry,
        String description,
        String portalGroup,
        String kind,
        String runtime,
        Integer sort,
        Integer status
) {}
