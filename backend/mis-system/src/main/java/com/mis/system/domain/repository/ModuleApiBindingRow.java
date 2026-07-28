package com.mis.system.domain.repository;

/** 模块详情：接口 ↔ 菜单绑定投影。 */
public interface ModuleApiBindingRow {
    Long getMenuId();

    String getMenuName();

    String getPermission();

    Long getApiId();

    String getApiName();

    String getHttpMethod();

    String getPathPattern();
}
