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

    /** 手机号在「租户 + APP」内唯一（D4）：非空才校验 */
    boolean existsByTenantIdAndAppIdAndPhone(Long tenantId, Long appId, String phone);

    /** 手机号唯一（排除自身，编辑场景） */
    boolean existsByTenantIdAndAppIdAndPhoneAndIdNot(Long tenantId, Long appId, String phone, Long id);

    /** 员工在「租户 + APP」内唯一（D1）：每个 APP 内 employeeId 唯一 */
    boolean existsByTenantIdAndAppIdAndEmployeeId(Long tenantId, Long appId, Long employeeId);

    /** 员工唯一（排除自身，编辑场景） */
    boolean existsByTenantIdAndAppIdAndEmployeeIdAndIdNot(Long tenantId, Long appId, Long employeeId, Long id);

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

    /**
     * 多 APP 分页查询（跨 APP 查询，D2）。
     * <ul>
     *   <li>appIds 非空且 hasAppFilter=true：按 {@code appId IN :appIds} 过滤（取并集）；</li>
     *   <li>appIds 为空且 hasAppFilter=false：跳过 appId 过滤（查全部 APP，契合 D2）。</li>
     * </ul>
     */
    @Query("""
            SELECT u FROM SysUser u
            WHERE u.tenantId = :tenantId
              AND (:hasAppFilter = false OR u.appId IN :appIds)
              AND (:status IS NULL OR u.status = :status)
              AND (:username = '' OR u.username LIKE CONCAT('%', :username, '%'))
              AND (:realName = '' OR u.realName LIKE CONCAT('%', :realName, '%'))
              AND (:phone = '' OR u.phone = :phone)
              AND (:hasCandidate = false OR u.id IN :candidateUserIds)
            """)
    Page<SysUser> searchV3(
            @Param("tenantId") Long tenantId,
            @Param("appIds") Collection<Long> appIds,
            @Param("hasAppFilter") boolean hasAppFilter,
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
