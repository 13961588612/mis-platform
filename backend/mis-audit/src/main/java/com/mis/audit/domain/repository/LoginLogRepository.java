package com.mis.audit.domain.repository;

import com.mis.audit.domain.entity.SysLoginLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;

public interface LoginLogRepository extends JpaRepository<SysLoginLog, Long>, JpaSpecificationExecutor<SysLoginLog> {

    @Query("""
            SELECT COUNT(l) FROM SysLoginLog l
            WHERE l.tenantId = :tenantId AND l.appId = :appId
              AND l.status = 1
              AND l.loginAt >= :start AND l.loginAt < :end
            """)
    long countSuccessBetween(
            @Param("tenantId") Long tenantId,
            @Param("appId") Long appId,
            @Param("start") Instant start,
            @Param("end") Instant end);
}
