package com.mis.iam.domain.repository;

import com.mis.iam.domain.entity.SysUser;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface SysUserRepository extends JpaRepository<SysUser, Long> {

    Optional<SysUser> findByTenantIdAndAppIdAndUsername(Long tenantId, Long appId, String username);

    @Query("""
            SELECT u FROM SysUser u
            WHERE u.tenantId = :tenantId AND u.appId = :appId
              AND (:status IS NULL OR u.status = :status)
              AND (:username = '' OR u.username LIKE CONCAT('%', :username, '%'))
              AND (:hasEmployeeFilter = false OR u.employeeId IN :employeeIds)
            """)
    Page<SysUser> search(
            @Param("tenantId") Long tenantId,
            @Param("appId") Long appId,
            @Param("status") Integer status,
            @Param("username") String username,
            @Param("hasEmployeeFilter") boolean hasEmployeeFilter,
            @Param("employeeIds") Collection<Long> employeeIds,
            Pageable pageable);

    boolean existsByTenantIdAndAppIdAndUsername(Long tenantId, Long appId, String username);

    boolean existsByEmployeeId(Long employeeId);

    List<SysUser> findByEmployeeId(Long employeeId);

    @Query("""
            SELECT u FROM SysUser u
            WHERE u.tenantId = :tenantId AND u.appId = :appId
              AND (:status IS NULL OR u.status = :status)
              AND (:username = '' OR u.username LIKE CONCAT('%', :username, '%'))
              AND (:realName = '' OR u.realName LIKE CONCAT('%', :realName, '%'))
              AND (:phone = '' OR u.phone = :phone)
              AND (:hasCandidate = false OR u.id IN :candidateUserIds)
            """)
    Page<SysUser> searchV2(
            @Param("tenantId") Long tenantId,
            @Param("appId") Long appId,
            @Param("status") Integer status,
            @Param("username") String username,
            @Param("realName") String realName,
            @Param("phone") String phone,
            @Param("candidateUserIds") Collection<Long> candidateUserIds,
            @Param("hasCandidate") boolean hasCandidate,
            Pageable pageable);

    @Query("""
            SELECT COUNT(u) FROM SysUser u
            WHERE u.tenantId = :tenantId AND u.appId = :appId
              AND u.isTenantAdmin = 1 AND u.status = 1
            """)
    long countActiveTenantAdmins(@Param("tenantId") Long tenantId, @Param("appId") Long appId);

    long countByTenantIdAndAppId(Long tenantId, Long appId);
}
