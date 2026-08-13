package com.mis.org.domain.repository;

import com.mis.org.domain.entity.SysPostType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SysPostTypeRepository extends JpaRepository<SysPostType, Long> {

    List<SysPostType> findByTenantIdAndStatus(Long tenantId, Integer status);

    Optional<SysPostType> findByTenantIdAndId(Long tenantId, Long id);
}
