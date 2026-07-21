package com.mis.adminbff.dto;

import java.util.List;

/** 前端动态路由节点（api-specification §3.1）。 */
public record RouterNode(
        String id,
        String name,
        String path,
        String component,
        RouterMeta meta,
        List<RouterNode> children
) {
    public record RouterMeta(String title, String icon, String permission) {}
}
