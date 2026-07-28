package com.mis.system.domain.repository;

import com.mis.system.domain.entity.SysMenuApi;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

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
    List<ModuleApiBindingRow> findBindingsByModuleId(@Param("moduleId") Long moduleId);

    /**
     * 给定一批菜单，返回各自绑定的接口（method + path_pattern），供菜单树「关联 API」区展示。
     */
    @Query(value = """
            SELECT ma.menu_id     AS menuId,
                   a.http_method  AS method,
                   a.path_pattern AS path
            FROM sys_menu_api ma
            JOIN sys_api a ON a.id = ma.api_id
            WHERE ma.menu_id IN :menuIds
            ORDER BY ma.menu_id, ma.sort
            """, nativeQuery = true)
    List<MenuApiRow> findApisByMenuIds(@Param("menuIds") List<Long> menuIds);
}
