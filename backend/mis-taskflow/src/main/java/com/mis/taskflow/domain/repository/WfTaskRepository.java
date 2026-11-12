package com.mis.taskflow.domain.repository;

import com.mis.taskflow.domain.entity.WfTask;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface WfTaskRepository extends JpaRepository<WfTask, Long> {

    Optional<WfTask> findByIdAndTenantId(Long id, Long tenantId);

    List<WfTask> findByInstanceIdOrderByCreatedAtAsc(Long instanceId);

    @Query("""
            select t from WfTask t
            where t.instanceId = :instanceId and t.status = 'PENDING'
            order by t.createdAt asc
            """)
    List<WfTask> findPendingByInstance(@Param("instanceId") Long instanceId);

    Optional<WfTask> findFirstByInstanceIdAndNodeCodeAndStatus(Long instanceId, String nodeCode, String status);

    List<WfTask> findByInstanceIdAndNodeCodeOrderByCreatedAtAsc(Long instanceId, String nodeCode);

    /** 按关联 sys_task 批量反查（门户待办补齐发起人时用；同一 sys_task 多行时取任意一条即可）。 */
    List<WfTask> findBySysTaskIdIn(List<Long> sysTaskIds);

    /** 单条反查：消息 reference_task_id → 流程实例。 */
    Optional<WfTask> findFirstBySysTaskId(Long sysTaskId);

    @Query("""
            select count(t) from WfTask t
            where t.instanceId = :instanceId and t.nodeCode = :nodeCode and t.status = 'PENDING'
            """)
    long countPendingByNode(@Param("instanceId") Long instanceId, @Param("nodeCode") String nodeCode);

    @Query("""
            select count(t) from WfTask t
            where t.instanceId = :instanceId and t.nodeCode = :nodeCode and t.status = 'COMPLETED'
            """)
    long countCompletedByNode(@Param("instanceId") Long instanceId, @Param("nodeCode") String nodeCode);

    @Query("""
            select count(t) from WfTask t
            where t.instanceId = :instanceId and t.nodeCode = :nodeCode
            """)
    long countByNode(@Param("instanceId") Long instanceId, @Param("nodeCode") String nodeCode);
}
