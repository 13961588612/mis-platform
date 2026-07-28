package com.mis.system.domain.repository;

/** 菜单树：菜单绑定的接口 method/path 投影。 */
public interface MenuApiRow {
    Long getMenuId();

    String getMethod();

    String getPath();
}
