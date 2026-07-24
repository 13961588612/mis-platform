package com.mis.system.domain.repository;

import com.mis.system.domain.entity.SysApi;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface SysApiRepository extends JpaRepository<SysApi, Long> {

    List<SysApi> findByAppIdOrderBySortAscCodeAsc(Long appId);

    @Query(value = """
            SELECT a.http_method AS httpMethod,
                   a.path_pattern AS pathPattern,
                   m.permission AS permission
            FROM sys_api a
            JOIN sys_menu_api ma ON ma.api_id = a.id
            JOIN sys_menu m ON ma.menu_id = m.id
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
    }
}
