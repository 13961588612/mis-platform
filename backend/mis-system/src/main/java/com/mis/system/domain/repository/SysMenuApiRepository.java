package com.mis.system.domain.repository;

import com.mis.system.domain.entity.SysMenuApi;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface SysMenuApiRepository extends JpaRepository<SysMenuApi, Long> {

    /**
     * 某模块下「接口 ↔ 菜单」绑定关系（只读，供模块详情展示）。
     */
    @Query(value = """
            SELECT ma.menu_id     AS menuId,
                   m.name         AS menuName,
                   m.permission   AS permission,
                   a.id           AS apiId,
                   a.name         AS apiName,
                   a.http_method  AS httpMethod,
                   a.path_pattern AS pathPattern
            FROM sys_menu_api ma
            JOIN sys_menu m ON m.id = ma.menu_id
            JOIN sys_api a ON a.id = ma.api_id
            WHERE a.module_id = :moduleId
            ORDER BY ma.menu_id, ma.sort
            """, nativeQuery = true)
    List<ModuleApiBindingRow> findBindingsByModuleId(Long moduleId);

    interface ModuleApiBindingRow {
        Long getMenuId();

        String getMenuName();

        String getPermission();

        Long getApiId();

        String getApiName();

        String getHttpMethod();

        String getPathPattern();
    }
}
