package com.mis.taskflow.domain.repository;

import com.mis.taskflow.domain.entity.BizExecutionTask;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

public interface BizExecutionTaskRepository extends JpaRepository<BizExecutionTask, Long> {

    /** 待执行：WAITING；或 FAILED 且已到重试时间。 */
    @Query("""
            select t from BizExecutionTask t
            where t.txStatus = 'WAITING'
               or (t.txStatus = 'FAILED' and (t.nextRetryAt is null or t.nextRetryAt <= :now))
            order by t.createdAt asc
            """)
    List<BizExecutionTask> findRunnable(@Param("now") LocalDateTime now, Pageable pageable);

    /** 存量扫描上限辅助。 */
    default List<BizExecutionTask> findRunnableTop(LocalDateTime now, int limit) {
        return findRunnable(now, org.springframework.data.domain.PageRequest.of(0, Math.max(limit, 1)));
    }

    @Query("""
            select t from BizExecutionTask t
            where (:status is null or t.txStatus = :status)
            order by t.createdAt desc
            """)
    Page<BizExecutionTask> findForMonitor(@Param("status") String status, Pageable pageable);

    List<BizExecutionTask> findBySourceInstanceId(Long sourceInstanceId);
}
