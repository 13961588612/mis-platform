package com.mis.org.dto;

public record DeptCategoryVO(
        String id,
        String tenantId,
        String code,
        String name,
        Integer sort,
        Integer status
) {}
