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

    /**
     * 引用计数：实际以该 formCode 启动过的实例数。
     *
     * <p>{@code started_form_code} 是无外键的字符串软引用——表单定义删除前必须查，
     * 否则历史实例的审批页会失去表单语义。
     */
    @Query("""
            select count(i) from WfInstance i
            where i.tenantId = :tenantId and i.startedFormCode = :code
            """)
    long countByStartedFormCode(@Param("tenantId") Long tenantId, @Param("code") String code);
}
