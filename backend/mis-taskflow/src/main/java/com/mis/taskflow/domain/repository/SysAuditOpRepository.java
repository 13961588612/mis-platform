package com.mis.taskflow.domain.repository;

import com.mis.taskflow.domain.entity.SysAuditOp;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 业务审计仓储。
 *
 * <p><b>为什么用原生 SQL</b>：多条件检索里 {@code keyword} 只出现在
 * {@code lower(concat('%', :keyword, '%'))} 中，缺少 {@code =} 比较来锚定类型；
 * 当 keyword 为 null 时 PostgreSQL 会把参数推断为 {@code bytea}，导致
 * {@code function lower(bytea) does not exist}（生产实测踩到，见 P8 调试记录）。
 * 原生 SQL 用 {@code CAST(:param AS text/timestamptz)} 显式定型即可避免。
 */
public interface SysAuditOpRepository extends JpaRepository<SysAuditOp, Long> {

    @Query(value = """
            SELECT * FROM sys_audit_op a
            WHERE a.tenant_id = :tenantId
              AND (CAST(:userId AS bigint) IS NULL OR a.user_id = CAST(:userId AS bigint))
              AND (CAST(:module AS text) IS NULL OR a.module = CAST(:module AS text))
              AND (CAST(:operationType AS text) IS NULL OR a.operation_type = CAST(:operationType AS text))
              AND (CAST(:businessType AS text) IS NULL OR a.business_type = CAST(:businessType AS text))
              AND (CAST(:resultStatus AS text) IS NULL OR a.result_status = CAST(:resultStatus AS text))
              AND (CAST(:startTime AS timestamptz) IS NULL OR a.oper_time >= CAST(:startTime AS timestamptz))
              AND (CAST(:endTime AS timestamptz) IS NULL OR a.oper_time <= CAST(:endTime AS timestamptz))
              AND (CAST(:keyword AS text) IS NULL
                   OR lower(a.description) LIKE lower('%' || CAST(:keyword AS text) || '%')
                   OR lower(a.business_id) LIKE lower('%' || CAST(:keyword AS text) || '%'))
            ORDER BY a.oper_time DESC
            """,
            countQuery = """
            SELECT count(*) FROM sys_audit_op a
            WHERE a.tenant_id = :tenantId
              AND (CAST(:userId AS bigint) IS NULL OR a.user_id = CAST(:userId AS bigint))
              AND (CAST(:module AS text) IS NULL OR a.module = CAST(:module AS text))
              AND (CAST(:operationType AS text) IS NULL OR a.operation_type = CAST(:operationType AS text))
              AND (CAST(:businessType AS text) IS NULL OR a.business_type = CAST(:businessType AS text))
              AND (CAST(:resultStatus AS text) IS NULL OR a.result_status = CAST(:resultStatus AS text))
              AND (CAST(:startTime AS timestamptz) IS NULL OR a.oper_time >= CAST(:startTime AS timestamptz))
              AND (CAST(:endTime AS timestamptz) IS NULL OR a.oper_time <= CAST(:endTime AS timestamptz))
              AND (CAST(:keyword AS text) IS NULL
                   OR lower(a.description) LIKE lower('%' || CAST(:keyword AS text) || '%')
                   OR lower(a.business_id) LIKE lower('%' || CAST(:keyword AS text) || '%'))
            """,
            nativeQuery = true)
    Page<SysAuditOp> search(@Param("tenantId") Long tenantId,
                            @Param("userId") Long userId,
                            @Param("module") String module,
                            @Param("operationType") String operationType,
                            @Param("businessType") String businessType,
                            @Param("resultStatus") String resultStatus,
                            @Param("startTime") LocalDateTime startTime,
                            @Param("endTime") LocalDateTime endTime,
                            @Param("keyword") String keyword,
                            Pageable pageable);

    /** 某条业务的完整操作时间线。 */
    List<SysAuditOp> findByTenantIdAndBusinessTypeAndBusinessIdOrderByOperTimeAsc(
            Long tenantId, String businessType, String businessId);

    /** 统计：区间内操作总数。 */
    @Query("""
            select count(a) from SysAuditOp a
            where a.tenantId = :tenantId and a.operTime >= :startTime
            """)
    long countSince(@Param("tenantId") Long tenantId, @Param("startTime") LocalDateTime startTime);

    /** 统计：失败操作数。 */
    @Query("""
            select count(a) from SysAuditOp a
            where a.tenantId = :tenantId and a.operTime >= :startTime and a.resultStatus <> 'SUCCESS'
            """)
    long countFailedSince(@Param("tenantId") Long tenantId, @Param("startTime") LocalDateTime startTime);
}