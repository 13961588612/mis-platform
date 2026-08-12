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
     * 给定一批菜单，返回各自绑定的接口（apiId + method + path_pattern），供菜单树「关联 API」区展示。
     */
    @Query(value = """
            SELECT ma.menu_id     AS menuId,
                   a.id           AS apiId,
                   a.http_method  AS method,
                   a.path_pattern AS path
            FROM sys_menu_api ma
            JOIN sys_api a ON a.id = ma.api_id
            WHERE ma.menu_id IN :menuIds
            ORDER BY ma.menu_id, ma.sort
            """, nativeQuery = true)
    List<MenuApiRow> findApisByMenuIds(@Param("menuIds") List<Long> menuIds);

    /**
     * 单个菜单的已绑定接口明细（含名称，供绑定弹层回显勾选用）。
     */
    @Query(value = """
            SELECT ma.menu_id     AS menuId,
                   a.id           AS apiId,
                   a.name         AS name,
                   a.http_method  AS method,
                   a.path_pattern AS path
            FROM sys_menu_api ma
            JOIN sys_api a ON a.id = ma.api_id
            WHERE ma.menu_id = :menuId
            ORDER BY ma.sort
            """, nativeQuery = true)
    List<MenuApiBindingRow> findApiItemsByMenuId(@Param("menuId") Long menuId);

    /**
     * 删除某菜单的全部绑定行（全量替换删除步，须在 {@code @Transactional} 内调用）。
     */
    void deleteByMenuId(Long menuId);
}
