package com.mis.system.domain.repository;

import com.mis.system.domain.entity.SysDictType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SysDictTypeRepository extends JpaRepository<SysDictType, Long> {

    List<SysDictType> findByTenantIdOrderByCodeAsc(Long tenantId);

    Optional<SysDictType> findByTenantIdAndCode(Long tenantId, String code);

    boolean existsByTenantIdAndCode(Long tenantId, String code);
}
