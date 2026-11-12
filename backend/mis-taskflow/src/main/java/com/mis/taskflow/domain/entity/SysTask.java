package com.mis.taskflow.domain.entity;

import com.mis.taskflow.support.TaskflowStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * 代办任务 {@code sys_task} —— 用户视角的「我要处理的活」。
 *
 * <p>设计要点（见 06-workflow-architecture-final-design-v4.md）：
 * <ul>
 *   <li>业务引用 {@code bizType + bizRefId} 仅存于此表（无独立桥接表）。</li>
 *   <li>{@code metadata} 可选存放 {@code wfInstanceId / wfTaskId / currentNode} 等流程映射。</li>
 *   <li>状态机见 {@link TaskflowStatus.Task}；非法流转由 Service 拦截。</li>
 * </ul>
 */
@Entity
@Table(name = "sys_task")
public class SysTask {

    /** 抄送类任务（与审批待办隔离，见「抄送我的」）。 */
    public static final String TYPE_CC = "CC";

    @Id
    private Long id;

    @Column(name = "tenant_id", nullable = false)
    private Long tenantId;

    @Column(name = "task_type", nullable = false, length = 32)
    private String taskType;

    @Column(name = "biz_type", nullable = false, length = 64)
    private String bizType;

    @Column(name = "biz_ref_id", nullable = false, length = 128)
    private String bizRefId;

    @Column(name = "biz_title", nullable = false, length = 256)
    private String bizTitle;

    @Column(name = "target_entity", length = 64)
    private String targetEntity;

    @Column(name = "assignee_id", nullable = false)
    private Long assigneeId;

    @Column(name = "assignee_name", length = 64)
    private String assigneeName;

    @Column(nullable = false, length = 16)
    private String status = TaskflowStatus.Task.PENDING;

    @Column(nullable = false)
    private Short priority = 1;

    @Column(name = "due_date")
    private LocalDateTime dueDate;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private String metadata = "{}";

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private String result;

    @Column(name = "read_flag", nullable = false)
    private Boolean read = Boolean.FALSE;

    @Column(name = "viewed_at")
    private LocalDateTime viewedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    @Column(nullable = false)
    private Integer deleted = 0;

    @Column(name = "created_by")
    private Long createdBy;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    /**
     * 应用归属（{@code sys_app.code}）；{@code NULL} = 平台级。
     *
     * <p>原则上待办必来自某业务流程 ⇒ 应有所属 APP；人工/脚本直插的运维待办可为
     * {@code NULL}（平台级）。写入仅在创建漏斗（{@code TaskService.createTask}）发生；
     * UPDATE 路径（{@code handleTask} / {@code transferTask}）**不得**改动 `app_code`，
     * 否则会清空既有归属。列由 V136 迁移新增。
     */
    @Column(name = "app_code", length = 64)
    private String appCode;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getTenantId() { return tenantId; }
    public void setTenantId(Long tenantId) { this.tenantId = tenantId; }
    public String getTaskType() { return taskType; }
    public void setTaskType(String taskType) { this.taskType = taskType; }
    public String getBizType() { return bizType; }
    public void setBizType(String bizType) { this.bizType = bizType; }
    public String getBizRefId() { return bizRefId; }
    public void setBizRefId(String bizRefId) { this.bizRefId = bizRefId; }
    public String getBizTitle() { return bizTitle; }
    public void setBizTitle(String bizTitle) { this.bizTitle = bizTitle; }
    public String getTargetEntity() { return targetEntity; }
    public void setTargetEntity(String targetEntity) { this.targetEntity = targetEntity; }
    public Long getAssigneeId() { return assigneeId; }
    public void setAssigneeId(Long assigneeId) { this.assigneeId = assigneeId; }
    public String getAssigneeName() { return assigneeName; }
    public void setAssigneeName(String assigneeName) { this.assigneeName = assigneeName; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Short getPriority() { return priority; }
    public void setPriority(Short priority) { this.priority = priority; }
    public LocalDateTime getDueDate() { return dueDate; }
    public void setDueDate(LocalDateTime dueDate) { this.dueDate = dueDate; }
    public String getMetadata() { return metadata; }
    public void setMetadata(String metadata) { this.metadata = metadata; }
    public String getResult() { return result; }
    public void setResult(String result) { this.result = result; }
    public Boolean getRead() { return read; }
    public void setRead(Boolean read) { this.read = read; }
    public LocalDateTime getViewedAt() { return viewedAt; }
    public void setViewedAt(LocalDateTime viewedAt) { this.viewedAt = viewedAt; }
    public LocalDateTime getCompletedAt() { return completedAt; }
    public void setCompletedAt(LocalDateTime completedAt) { this.completedAt = completedAt; }
    public Integer getDeleted() { return deleted; }
    public void setDeleted(Integer deleted) { this.deleted = deleted; }
    public Long getCreatedBy() { return createdBy; }
    public void setCreatedBy(Long createdBy) { this.createdBy = createdBy; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
    public String getAppCode() { return appCode; }
    public void setAppCode(String appCode) { this.appCode = appCode; }
}