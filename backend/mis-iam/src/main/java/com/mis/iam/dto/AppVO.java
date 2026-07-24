package com.mis.iam.dto;

public record AppVO(
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
        Integer status
) {}
