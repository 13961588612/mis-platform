package com.mis.iam.domain.repository;

import com.mis.iam.domain.entity.SysUser;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.Optional;

public interface SysUserRepository extends JpaRepository<SysUser, Long> {

    Optional<SysUser> findByTenantIdAndAppIdAndUsername(Long tenantId, Long appId, String username);

    @Query("SELECT u FROM SysUser u WHERE u.tenantId = ?1 AND u.appId = ?2")
    Page<SysUser> findByTenantIdAndAppId(Long tenantId, Long appId, Pageable pageable);

    @Query("SELECT u FROM SysUser u WHERE u.tenantId = ?1 AND u.appId = ?2 AND u.status = ?3")
    Page<SysUser> findByTenantIdAndAppIdAndStatus(Long tenantId, Long appId, Integer status, Pageable pageable);

    boolean existsByTenantIdAndAppIdAndUsername(Long tenantId, Long appId, String username);

    boolean existsByEmployeeId(Long employeeId);
}
