package com.mis.system.dto;

/** 单个菜单已绑定接口的响应 DTO（含 name 供弹层展示）。 */
public record MenuApiBindingItem(
        String apiId,
        String name,
        String method,
        String path
) {}
