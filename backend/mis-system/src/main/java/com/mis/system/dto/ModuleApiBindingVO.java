package com.mis.system.dto;

/**
 * 模块下「接口 ↔ 菜单」绑定关系（只读）。
 */
public record ModuleApiBindingVO(
        String menuId,
        String menuName,
        String permission,
        String apiId,
        String apiName,
        String httpMethod,
        String pathPattern
) {}
