package com.mis.iam.dto;

public record AppUpdateRequest(
        String name,
        String icon,
        String basePath,
        String mfeRemote,
        String description,
        String portalGroup,
        String kind,
        String runtime,
        Integer sort,
        Integer status
) {}
