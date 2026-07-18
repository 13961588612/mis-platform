package com.mis.iam.domain.repository;

import com.mis.iam.domain.entity.SysRole;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface SysRoleRepository extends JpaRepository<SysRole, Long> {

    List<SysRole> findByTenantIdAndAppIdAndStatus(Long tenantId, Long appId, Integer status);

    Optional<SysRole> findByTenantIdAndAppIdAndCode(Long tenantId, Long appId, String code);

    @Query("SELECT r.code FROM SysRole r JOIN SysUserRole ur ON r.id = ur.roleId WHERE ur.userId = ?1 AND r.status = 1")
    List<String> findRoleCodesByUserId(Long userId);
}
