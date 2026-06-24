package com.mis.auth.domain.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SysRoleRepository extends JpaRepository<com.mis.auth.domain.entity.SysRole, Long> {

    @Query(value = """
            SELECT r.code FROM sys_role r
            INNER JOIN sys_user_role ur ON ur.role_id = r.id
            WHERE ur.user_id = :userId AND r.deleted = 0
            """, nativeQuery = true)
    java.util.List<String> findRoleCodesByUserId(@Param("userId") Long userId);
}
