package com.mis.system.domain.repository;

/** 菜单树：菜单绑定的接口 apiId/method/path 投影。 */
public interface MenuApiRow {
    Long getMenuId();

    Long getApiId();

    String getMethod();

    String getPath();
}
