package com.mis.taskflow.domain.repository;

import com.mis.taskflow.domain.entity.SysTask;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.Optional;

public interface SysTaskRepository extends JpaRepository<SysTask, Long> {

    Optional<SysTask> findByIdAndDeleted(Long id, Integer deleted);

    /**
     * 悲观写锁读取单条待办——处理（act）与转办（transfer）共用同一把行锁。
     *
     * <p><b>为什么不用 {@code @Version} 乐观锁</b>：冲突抛 {@code OptimisticLockingFailureException}，
     * 语义是「你失败了」而非「已被他人处理」，需要额外映射才能给前端正确提示，且要加迁移列。
     *
     * <p><b>为什么不用 DistributedLockService</b>：它是 Redis 轮询实现，
     * {@code POLL_TIMEOUT=60s}，用户点「同意」要等 60 秒不可接受。
     *
     * <p>刻意<b>不</b>把 {@code tenantId} 放进 where 条件：跨租户访问要能区分
     * 「不存在」（NOT_FOUND）与「无权限」（FORBIDDEN），故租户与 assignee 校验在 Service 层做。
     *
     * <p>行锁在事务提交/回滚时释放，事务边界由 {@code @Transactional} 方法承担。
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from SysTask t where t.id = :id and t.deleted = 0")
    Optional<SysTask> findByIdForUpdate(@Param("id") Long id);

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