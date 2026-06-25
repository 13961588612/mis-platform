package com.mis.audit.domain.repository;

import com.mis.audit.domain.entity.SysLoginLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

public interface LoginLogRepository extends JpaRepository<SysLoginLog, Long>, JpaSpecificationExecutor<SysLoginLog> {
}
