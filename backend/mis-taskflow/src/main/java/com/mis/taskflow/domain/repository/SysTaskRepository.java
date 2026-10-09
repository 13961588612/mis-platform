package com.mis.taskflow.domain.repository;

import com.mis.taskflow.domain.entity.SysTask;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.Optional;

public interface SysTaskRepository extends JpaRepository<SysTask, Long> {

    Optional<SysTask> findByIdAndDeleted(Long id, Integer deleted);

    @Query("""
            select t from SysTask t
            where t.tenantId = :tenantId
              and t.assigneeId = :assigneeId
              and t.deleted = 0
              and (:status is null or t.status = :status)
            order by t.priority desc, t.createdAt desc
            """)
    Page<SysTask> findByAssignee(@Param("tenantId") Long tenantId,
                                 @Param("assigneeId") Long assigneeId,
                                 @Param("status") String status,
                                 Pageable pageable);

    @Query("""
            select t from SysTask t
            where t.tenantId = :tenantId
              and t.assigneeId = :assigneeId
              and t.deleted = 0
              and t.status in ('PENDING', 'APPROVING')
            order by t.priority desc, t.createdAt desc
            """)
    Page<SysTask> findOpenByAssignee(@Param("tenantId") Long tenantId,
                                     @Param("assigneeId") Long assigneeId,
                                     Pageable pageable);

    @Query("""
            select count(t) from SysTask t
            where t.tenantId = :tenantId and t.assigneeId = :assigneeId
              and t.deleted = 0 and t.status in ('PENDING', 'APPROVING')
            """)
    long countPending(@Param("tenantId") Long tenantId, @Param("assigneeId") Long assigneeId);

    /** 我处理过的（已通过 / 已驳回），按完成时间倒序——用于「我审批的」。 */
    @Query("""
            select t from SysTask t
            where t.tenantId = :tenantId
              and t.assigneeId = :assigneeId
              and t.deleted = 0
              and t.status in ('APPROVED', 'REJECTED')
            order by t.completedAt desc, t.createdAt desc
            """)
    Page<SysTask> findHandledByAssignee(@Param("tenantId") Long tenantId,
                                        @Param("assigneeId") Long assigneeId,
                                        Pageable pageable);

    @Query("""
            select count(t) from SysTask t
            where t.tenantId = :tenantId and t.assigneeId = :assigneeId
              and t.deleted = 0 and t.status in ('PENDING', 'APPROVING') and t.priority = 4
            """)
    long countUrgent(@Param("tenantId") Long tenantId, @Param("assigneeId") Long assigneeId);

    @Query("""
            select count(t) from SysTask t
            where t.tenantId = :tenantId and t.assigneeId = :assigneeId
              and t.deleted = 0 and t.status in ('PENDING', 'APPROVING')
              and t.dueDate is not null and t.dueDate < :now
            """)
    long countOverdue(@Param("tenantId") Long tenantId,
                      @Param("assigneeId") Long assigneeId,
                      @Param("now") LocalDateTime now);
}