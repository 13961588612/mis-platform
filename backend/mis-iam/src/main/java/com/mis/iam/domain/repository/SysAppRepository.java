package com.mis.iam.domain.repository;

import com.mis.iam.domain.entity.SysApp;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SysAppRepository extends JpaRepository<SysApp, Long> {

    Optional<SysApp> findByTenantIdAndCode(Long tenantId, String code);

    List<SysApp> findByTenantIdAndStatus(Long tenantId, Integer status);
}
