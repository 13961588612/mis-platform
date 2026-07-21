package com.mis.system.dto;

import java.util.List;

public record ApiVO(
        String id,
        String tenantId,
        String appId,
        String moduleId,
        String parentId,
        String code,
        String type,
        String name,
        String httpMethod,
        String pathPattern,
        Integer sort,
        Integer status,
        List<ApiVO> children
) {}
