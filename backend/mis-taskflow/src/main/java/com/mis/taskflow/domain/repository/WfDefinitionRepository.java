package com.mis.taskflow.domain.repository;

import com.mis.taskflow.domain.entity.WfDefinition;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface WfDefinitionRepository extends JpaRepository<WfDefinition, Long> {

    Optional<WfDefinition> findByIdAndDeleted(Long id, Integer deleted);

    /** 取某编码下已发布的最新版本。 */
    Optional<WfDefinition> findFirstByTenantIdAndCodeAndStatusAndDeletedOrderByVersionDesc(
            Long tenantId, String code, String status, Integer deleted);

    List<WfDefinition> findByTenantIdAndDeletedOrderByUpdatedAtDesc(Long tenantId, Integer deleted);

    Page<WfDefinition> findByTenantIdAndDeleted(Long tenantId, Integer deleted, Pageable pageable);
}
