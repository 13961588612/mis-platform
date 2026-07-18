package com.mis.org.domain.repository;

import com.mis.org.domain.entity.SysOrg;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SysOrgRepository extends JpaRepository<SysOrg, Long> {

    Optional<SysOrg> findByTenantIdAndCode(Long tenantId, String code);

    List<SysOrg> findByTenantIdAndStatus(Long tenantId, Integer status);
}
