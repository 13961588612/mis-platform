package com.mis.taskflow.domain.repository;

import com.mis.taskflow.domain.entity.FormRecord;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface FormRecordRepository extends JpaRepository<FormRecord, Long> {

    Optional<FormRecord> findByIdAndTenantIdAndDeleted(Long id, Long tenantId, Integer deleted);

    @Query("""
            select r from FormRecord r
             where r.tenantId = :tenantId and r.createdBy = :createdBy and r.deleted = 0
               and (:status is null or :status = '' or r.status = :status)
               and (:formCode is null or :formCode = '' or r.formCode = :formCode)
             order by r.updatedAt desc
            """)
    Page<FormRecord> findMine(@Param("tenantId") Long tenantId,
                              @Param("createdBy") Long createdBy,
                              @Param("status") String status,
                              @Param("formCode") String formCode,
                              Pageable pageable);

    Optional<FormRecord> findByCurrentInstanceIdAndTenantIdAndDeleted(
            Long currentInstanceId, Long tenantId, Integer deleted);
}
