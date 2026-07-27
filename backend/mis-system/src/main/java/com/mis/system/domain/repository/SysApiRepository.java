package com.mis.system.domain.repository;

import com.mis.system.domain.entity.SysApi;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface SysApiRepository extends JpaRepository<SysApi, Long> {

    List<SysApi> findByModuleIdOrderBySortAscCodeAsc(Long moduleId);

    boolean existsByModuleId(Long moduleId);

    long countByModuleId(Long moduleId);

    boolean existsByModuleIdAndCode(Long moduleId, String code);

    boolean existsByModuleIdAndCodeAndIdNot(Long moduleId, String code, Long id);

    boolean existsByParentId(Long parentId);

    /**
     * 模块下是否存在被菜单绑定的接口（Q4 模块删除前置校验）。
     */
    @Query(value = """
            SELECT COUNT(*) > 0
            FROM sys_menu_api ma
            WHERE ma.api_id IN (SELECT id FROM sys_api a WHERE a.module_id = :moduleId)
            """, nativeQuery = true)
    boolean existsBoundApiByModuleId(Long moduleId);

    /**
     * 单个接口是否被菜单绑定（防止产生悬空绑定行）。
     */
    @Query(value = "SELECT COUNT(*) > 0 FROM sys_menu_api ma WHERE ma.api_id = :apiId", nativeQuery = true)
    boolean existsBoundApi(Long apiId);

    /**
     * 鉴权注册表。
     * <p>JOIN sys_module 取出模块状态：<b>不</b>过滤 sm.status=1，使停用模块的接口规则仍留在注册表中，
     * 由 BFF 拦截器命中后按 module_status=0 直接返回 403（见 Q4 方案）。Q4 之前仅放行启用模块。</p>
     */
    @Query(value = """
            SELECT a.http_method AS httpMethod,
                   a.path_pattern AS pathPattern,
                   m.permission AS permission,
                   sm.status     AS moduleStatus
            FROM sys_api a
            JOIN sys_menu_api ma ON ma.api_id = a.id
            JOIN sys_menu m ON ma.menu_id = m.id
            JOIN sys_module sm ON sm.id = a.module_id
            WHERE a.type = 'api'
              AND a.status = 1
              AND m.status = 1
              AND a.http_method IS NOT NULL
              AND a.path_pattern IS NOT NULL
            """, nativeQuery = true)
    List<ApiPermissionRow> findRegistryRows();

    interface ApiPermissionRow {
        String getHttpMethod();

        String getPathPattern();

        String getPermission();

        Integer getModuleStatus();
    }
}
