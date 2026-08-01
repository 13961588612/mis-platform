package com.mis.org.domain.repository;

import com.mis.org.domain.entity.SysOrg;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface OrgMcpRepository extends JpaRepository<SysOrg, Long> {

    @Query(value = """
            SELECT o.*
            FROM sys_org o
            WHERE (o.name ILIKE '%' || :name || '%')
              AND o.id IN (SELECT org_id FROM sys_user_org WHERE user_id = :userId)
              AND o.tenant_id = :tenantId
              AND o.deleted = 0
            ORDER BY LENGTH(o.name) ASC
            LIMIT 5
            """, nativeQuery = true)
    List<SysOrg> findByNameLikeWithUserScope(
            @Param("name") String name,
            @Param("userId") Long userId,
            @Param("tenantId") Long tenantId);
}
