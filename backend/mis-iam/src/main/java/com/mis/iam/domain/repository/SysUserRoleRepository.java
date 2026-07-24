package com.mis.iam.domain.repository;

import com.mis.iam.domain.entity.SysUserRole;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SysUserRoleRepository extends JpaRepository<SysUserRole, Long> {

    List<SysUserRole> findByUserId(Long userId);

    void deleteByUserId(Long userId);

    void deleteByUserIdAndRoleId(Long userId, Long roleId);

    boolean existsByUserIdAndRoleId(Long userId, Long roleId);

    boolean existsByRoleId(Long roleId);
}
