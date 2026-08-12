package com.mis.system.domain.repository;

/** 单个菜单已绑定接口的明细投影（GET /menus/{menuId}/apis 回显用）。 */
public interface MenuApiBindingRow {
    Long getMenuId();

    Long getApiId();

    String getName();

    String getMethod();

    String getPath();
}
