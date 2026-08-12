package com.mis.adminbff.dto;

/** 单个菜单已绑定接口的对外响应 DTO（镜像 mis-system MenuApiBindingItem）。 */
public record MenuApiBindingVO(
        String apiId,
        String name,
        String method,
        String path
) {}
