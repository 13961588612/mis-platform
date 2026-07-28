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
        List<MenuVO> children,
        List<MenuApiItem> apiList
) {
    /** 菜单关联接口（经 sys_menu_api 绑定），用于菜单树「关联 API」区展示。 */
    public record MenuApiItem(String method, String path) {}
}
