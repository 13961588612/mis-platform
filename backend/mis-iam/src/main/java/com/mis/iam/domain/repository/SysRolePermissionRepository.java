package com.mis.iam.domain.repository;

import com.mis.iam.domain.entity.SysRolePermission;
import com.mis.iam.domain.entity.SysRolePermission.PermType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface SysRolePermissionRepository extends JpaRepository<SysRolePermission, Long> {

    List<SysRolePermission> findByRoleIdAndPermType(Long roleId, PermType permType);

    @Query("""
            SELECT DISTINCT rp.targetId FROM SysRolePermission rp
            JOIN SysUserRole ur ON ur.roleId = rp.roleId
            WHERE ur.userId = ?1 AND rp.permType = ?2
            """)
    List<Long> findTargetIdsByUserIdAndPermType(Long userId, PermType permType);

    @Query("SELECT DISTINCT ur.userId FROM SysUserRole ur WHERE ur.roleId = ?1")
    List<Long> findUserIdsByRoleId(Long roleId);

    @Modifying(clearAutomatically = true)
    @Query("DELETE FROM SysRolePermission rp WHERE rp.roleId = ?1 AND rp.permType = ?2")
    void deleteByRoleIdAndPermType(Long roleId, PermType permType);
}
