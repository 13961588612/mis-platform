package com.mis.adminbff.client.model;

import java.util.List;

/** 对齐 mis-system MenuVO。 */
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
