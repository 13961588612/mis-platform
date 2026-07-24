package com.mis.adminbff.dto;

public record AppView(
        String id,
        String tenantId,
        String code,
        String name,
        String icon,
        String basePath,
        String description,
        String portalGroup,
        String kind,
        String runtime,
        Integer sort,
        Integer status,
        boolean enterable
) {}
