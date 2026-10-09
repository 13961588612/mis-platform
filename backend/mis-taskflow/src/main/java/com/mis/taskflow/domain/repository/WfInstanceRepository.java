package com.mis.taskflow.domain.repository;

import com.mis.taskflow.domain.entity.WfInstance;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface WfInstanceRepository extends JpaRepository<WfInstance, Long> {

    Optional<WfInstance> findByIdAndTenantId(Long id, Long tenantId);

    List<WfInstance> findByTenantIdAndBusinessTypeAndBusinessIdOrderByCreatedAtDesc(
            Long tenantId, String businessType, String businessId);

    @Query("""
            select i from WfInstance i
            where i.tenantId = :tenantId
              and i.initiatorId = :initiatorId
              and (:status is null or i.status = :status)
            order by i.createdAt desc
            """)
    Page<WfInstance> findByInitiator(@Param("tenantId") Long tenantId,
                                     @Param("initiatorId") Long initiatorId,
                                     @Param("status") String status,
                                     Pageable pageable);
}
