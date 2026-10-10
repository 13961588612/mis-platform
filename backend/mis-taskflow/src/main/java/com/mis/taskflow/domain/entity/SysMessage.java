package com.mis.taskflow.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * 消息主表 {@code sys_message}。
 *
 * <p><b>设计要点</b>（见 docs/architecture/msg-log-workflow/06-workflow-architecture-final-design-v4.md）：
 * <ul>
 *   <li>{@code receiverIds} 为 {@code bigint[]}，仅用于快速过滤；每人独立的已读/处理状态以
 *       {@link SysMessageReceiver} 明细表为唯一事实源。</li>
 *   <li>{@code referenceTaskId} 关联代办（NULL 表示纯通知，不做桥接表）。</li>
 * </ul>
 */
@Entity
@Table(name = "sys_message")
public class SysMessage {

    @Id
    private Long id;

    @Column(name = "tenant_id", nullable = false)
    private Long tenantId;

    @Column(name = "msg_type", nullable = false, length = 32)
    private String msgType;

    @Column(nullable = false, length = 32)
    private String category;

    @Column(nullable = false, length = 256)
    private String title;

    @Column(columnDefinition = "text")
    private String summary;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private String content;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private String attachments = "[]";

    @Column(name = "sender_id")
    private Long senderId;

    @Column(name = "sender_name", length = 64)
    private String senderName;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "receiver_ids", nullable = false, columnDefinition = "bigint[]")
    private Long[] receiverIds;

    @Column(name = "receiver_group_type", nullable = false, length = 16)
    private String receiverGroupType = "SINGLE";

    /** 关联代办 ID；NULL = 纯通知。 */
    @Column(name = "reference_task_id")
    private Long referenceTaskId;

    /**
     * 关联流程实例 ID（{@code wf_instance.id} 的软引用，无外键）；NULL = 非流程通知。
     *
     * <p>由 {@code ProcessService.notify(...)} 写入，是 PR-07（流程通知看表单）
     * 与 PR-18（回复回写审批意见）单跳定位实例的唯一线索。
     */
    @Column(name = "instance_id")
    private Long instanceId;

    @Column(name = "read_count", nullable = false)
    private Integer readCount = 0;

    @Column(name = "total_count", nullable = false)
    private Integer totalCount = 0;

    @Column(nullable = false)
    private Integer deleted = 0;

    @Column(name = "created_by")
    private Long createdBy;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getTenantId() { return tenantId; }
    public void setTenantId(Long tenantId) { this.tenantId = tenantId; }
    public String getMsgType() { return msgType; }
    public void setMsgType(String msgType) { this.msgType = msgType; }
    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getSummary() { return summary; }
    public void setSummary(String summary) { this.summary = summary; }
    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }
    public String getAttachments() { return attachments; }
    public void setAttachments(String attachments) { this.attachments = attachments; }
    public Long getSenderId() { return senderId; }
    public void setSenderId(Long senderId) { this.senderId = senderId; }
    public String getSenderName() { return senderName; }
    public void setSenderName(String senderName) { this.senderName = senderName; }
    public Long[] getReceiverIds() { return receiverIds; }
    public void setReceiverIds(Long[] receiverIds) { this.receiverIds = receiverIds; }
    public String getReceiverGroupType() { return receiverGroupType; }
    public void setReceiverGroupType(String receiverGroupType) { this.receiverGroupType = receiverGroupType; }
    public Long getReferenceTaskId() { return referenceTaskId; }
    public void setReferenceTaskId(Long referenceTaskId) { this.referenceTaskId = referenceTaskId; }
    public Long getInstanceId() { return instanceId; }
    public void setInstanceId(Long instanceId) { this.instanceId = instanceId; }
    public Integer getReadCount() { return readCount; }
    public void setReadCount(Integer readCount) { this.readCount = readCount; }
    public Integer getTotalCount() { return totalCount; }
    public void setTotalCount(Integer totalCount) { this.totalCount = totalCount; }
    public Integer getDeleted() { return deleted; }
    public void setDeleted(Integer deleted) { this.deleted = deleted; }
    public Long getCreatedBy() { return createdBy; }
    public void setCreatedBy(Long createdBy) { this.createdBy = createdBy; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}