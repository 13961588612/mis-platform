package com.mis.iam.domain.repository;

import com.mis.iam.domain.entity.SysUser;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface SysUserRepository extends JpaRepository<SysUser, Long> {

    Optional<SysUser> findByTenantIdAndAppIdAndUsername(Long tenantId, Long appId, String username);

    @Query("""
            SELECT u FROM SysUser u
            WHERE u.tenantId = :tenantId AND u.appId = :appId
              AND (:status IS NULL OR u.status = :status)
              AND (:username IS NULL OR u.username LIKE CONCAT('%', :username, '%'))
            """)
    Page<SysUser> search(
            @Param("tenantId") Long tenantId,
            @Param("appId") Long appId,
            @Param("status") Integer status,
            @Param("username") String username,
            Pageable pageable);

    boolean existsByTenantIdAndAppIdAndUsername(Long tenantId, Long appId, String username);

    boolean existsByEmployeeId(Long employeeId);

    @Query("""
            SELECT COUNT(u) FROM SysUser u
            WHERE u.tenantId = :tenantId AND u.appId = :appId
              AND u.isTenantAdmin = 1 AND u.status = 1
            """)
    long countActiveTenantAdmins(@Param("tenantId") Long tenantId, @Param("appId") Long appId);

    long countByTenantIdAndAppId(Long tenantId, Long appId);
}
