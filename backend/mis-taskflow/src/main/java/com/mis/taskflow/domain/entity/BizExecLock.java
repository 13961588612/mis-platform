package com.mis.taskflow.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;

import java.io.Serializable;
import java.time.LocalDateTime;
import java.util.Objects;

/**
 * 分布式执行锁 {@code biz_exec_lock}。
 *
 * <p>复合主键 {@code (bizType, bizId)}；集群中多个实例竞争同一业务动作时，
 * 通过主键唯一性保证「同一业务同一时刻只有一个执行者」。
 *
 * <p>参见 docs/architecture/msg-log-workflow/06-workflow-architecture-final-design-v4.md：
 * 冲突时不能凭影响行数判成功，必须进入「状态轮询确认」，看到 {@code SUCCESS} 才返回成功。
 */
@Entity
@Table(name = "biz_exec_lock")
@IdClass(BizExecLock.LockId.class)
public class BizExecLock {

    public static final String RUNNING = "RUNNING";
    public static final String SUCCESS = "SUCCESS";
    public static final String FAILED = "FAILED";

    @Id
    @Column(name = "biz_type", nullable = false, length = 64)
    private String bizType;

    @Id
    @Column(name = "biz_id", nullable = false, length = 128)
    private String bizId;

    @Column(nullable = false, length = 16)
    private String status;

    @Column(name = "operator_service", length = 128)
    private String operatorService;

    @Column(name = "locked_at", nullable = false)
    private LocalDateTime lockedAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    public String getBizType() { return bizType; }
    public void setBizType(String bizType) { this.bizType = bizType; }
    public String getBizId() { return bizId; }
    public void setBizId(String bizId) { this.bizId = bizId; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getOperatorService() { return operatorService; }
    public void setOperatorService(String operatorService) { this.operatorService = operatorService; }
    public LocalDateTime getLockedAt() { return lockedAt; }
    public void setLockedAt(LocalDateTime lockedAt) { this.lockedAt = lockedAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }

    /** 复合主键。 */
    public static class LockId implements Serializable {
        private String bizType;
        private String bizId;

        public LockId() {
        }

        public LockId(String bizType, String bizId) {
            this.bizType = bizType;
            this.bizId = bizId;
        }

        public String getBizType() { return bizType; }
        public void setBizType(String bizType) { this.bizType = bizType; }
        public String getBizId() { return bizId; }
        public void setBizId(String bizId) { this.bizId = bizId; }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof LockId other)) return false;
            return Objects.equals(bizType, other.bizType) && Objects.equals(bizId, other.bizId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(bizType, bizId);
        }
    }
}
