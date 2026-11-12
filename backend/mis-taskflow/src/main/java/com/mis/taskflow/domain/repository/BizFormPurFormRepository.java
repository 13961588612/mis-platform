package com.mis.taskflow.domain.repository;

import com.mis.taskflow.domain.entity.BizFormPurForm;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface BizFormPurFormRepository extends JpaRepository<BizFormPurForm, Long> {

    Optional<BizFormPurForm> findByIdAndTenantIdAndDeleted(Long id, Long tenantId, Integer deleted);
}
