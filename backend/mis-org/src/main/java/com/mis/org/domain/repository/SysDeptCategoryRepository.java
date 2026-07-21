package com.mis.org.domain.repository;

import com.mis.org.domain.entity.SysDeptCategory;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SysDeptCategoryRepository extends JpaRepository<SysDeptCategory, Long> {

    List<SysDeptCategory> findByTenantIdAndStatus(Long tenantId, Integer status);

    Optional<SysDeptCategory> findByTenantIdAndCode(Long tenantId, String code);
}
