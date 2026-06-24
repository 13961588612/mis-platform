package com.mis.auth.domain.repository;

import com.mis.auth.domain.entity.SysUser;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface SysUserRepository extends JpaRepository<SysUser, Long> {

    Optional<SysUser> findByTenantIdAndAppIdAndUsernameAndStatus(Long tenantId, Long appId, String username, Integer status);
}
