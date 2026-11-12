package com.mis.taskflow.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/**
 * 消息接收者明细 {@code sys_message_receiver} —— 每人独立的已读/处理状态（唯一事实源）。
 */
@Entity
@Table(name = "sys_message_receiver")
public class SysMessageReceiver {

    /** 明细状态：可读未处理。 */
    public static final String STATUS_ACTIVE = "ACTIVE";
    /** 明细状态：已处理。 */
    public static final String STATUS_HANDLED = "HANDLED";
    /** 明细状态：已忽略。 */
    public static final String STATUS_IGNORED = "IGNORED";
    /** 明细状态：已归档。 */
    public static final String STATUS_ARCHIVED = "ARCHIVED";

    @Id
    private Long id;

    @Column(name = "tenant_id", nullable = false)
    private Long tenantId;

    @Column(name = "message_id", nullable = false)
    private Long messageId;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "read_flag", nullable = false)
    private Boolean read = Boolean.FALSE;

    @Column(name = "viewed_at")
    private LocalDateTime viewedAt;

    @Column(nullable = false, length = 16)
    private String status = STATUS_ACTIVE;

    @Column(name = "task_id")
    private Long taskId;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getTenantId() { return tenantId; }
    public void setTenantId(Long tenantId) { this.tenantId = tenantId; }
    public Long getMessageId() { return messageId; }
    public void setMessageId(Long messageId) { this.messageId = messageId; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public Boolean getRead() { return read; }
    public void setRead(Boolean read) { this.read = read; }
    public LocalDateTime getViewedAt() { return viewedAt; }
    public void setViewedAt(LocalDateTime viewedAt) { this.viewedAt = viewedAt; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Long getTaskId() { return taskId; }
    public void setTaskId(Long taskId) { this.taskId = taskId; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}