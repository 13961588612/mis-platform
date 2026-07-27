package com.mis.adminbff.dto;

import java.util.List;

public record ApiVO(
        String id,
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
