package com.mis.taskflow.domain.repository;

import com.mis.taskflow.domain.entity.BizExecLock;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.Optional;

public interface BizExecLockRepository extends JpaRepository<BizExecLock, BizExecLock.LockId> {

    Optional<BizExecLock> findByBizTypeAndBizId(String bizType, String bizId);

    /**
     * 条件更新锁状态（CAS）：仅当当前状态为 {@code expectedStatus} 时才更新。
     *
     * <p>用于「超时夺权」与「安全释放」：影响行数为 1 表示本实例仍持有锁。
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            update BizExecLock l
            set l.status = :newStatus, l.operatorService = :operatorService, l.updatedAt = :now
            where l.bizType = :bizType and l.bizId = :bizId and l.status = :expectedStatus
            """)
    int casStatus(@Param("bizType") String bizType,
                  @Param("bizId") String bizId,
                  @Param("expectedStatus") String expectedStatus,
                  @Param("newStatus") String newStatus,
                  @Param("operatorService") String operatorService,
                  @Param("now") LocalDateTime now);

    /** 物理删除锁（超时夺权前清理）。 */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("delete from BizExecLock l where l.bizType = :bizType and l.bizId = :bizId and l.status = :status")
    int deleteByStatus(@Param("bizType") String bizType,
                       @Param("bizId") String bizId,
                       @Param("status") String status);
}
