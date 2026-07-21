package com.mis.system.dto;

import java.util.List;

public record MenuVO(
        String id,
        String tenantId,
        String appId,
        String parentId,
        String code,
        String name,
        Integer type,
        String path,
        String component,
        String permission,
        String icon,
        Integer sort,
        Integer visible,
        Integer status,
        List<MenuVO> children
) {}
