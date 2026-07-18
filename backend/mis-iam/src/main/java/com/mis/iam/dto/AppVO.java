package com.mis.iam.dto;

public record AppVO(
        String id,
        String tenantId,
        String code,
        String name,
        String icon,
        String basePath,
        Integer sort,
        Integer status
) {}
