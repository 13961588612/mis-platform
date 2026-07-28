package com.mis.system.dto;

public record DictTypeVO(
        String id,
        String tenantId,
        String code,
        String name,
        Integer status,
        String remark
) {}
