package com.mis.taskflow.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * 流程任务 {@code wf_task} —— 引擎视角的节点执行单元。
 *
 * <p>{@code sysTaskId} 关联用户视角的 {@link SysTask}（纯流程任务可为空），
 * 前端只查 {@code sys_task}，流程完全对前端透明。
 */
@Entity
@Table(name = "wf_task")
public class WfTask {

    public static final String STATUS_PENDING = "PENDING";
    public static final String STATUS_COMPLETED = "COMPLETED";

    @Id
    private Long id;

    @Column(name = "tenant_id", nullable = false)
    private Long tenantId;

    @Column(name = "instance_id", nullable = false)
    private Long instanceId;

    @Column(name = "node_code", nullable = false, length = 64)
    private String nodeCode;

    @Column(name = "node_name", nullable = false, length = 128)
    private String nodeName;

    @Column(name = "task_type", nullable = false, length = 32)
    private String taskType = "APPROVE";

    @Column(name = "sys_task_id")
    private Long sysTaskId;

    @Column(name = "assignee_id", nullable = false)
    private Long assigneeId;

    @Column(name = "assignee_name", length = 64)
    private String assigneeName;

    @Column(nullable = false, length = 16)
    private String status = STATUS_PENDING;

    @Column(name = "due_date")
    private LocalDateTime dueDate;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "action_result", columnDefinition = "jsonb")
    private String actionResult;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getTenantId() { return tenantId; }
    public void setTenantId(Long tenantId) { this.tenantId = tenantId; }
    public Long getInstanceId() { return instanceId; }
    public void setInstanceId(Long instanceId) { this.instanceId = instanceId; }
    public String getNodeCode() { return nodeCode; }
    public void setNodeCode(String nodeCode) { this.nodeCode = nodeCode; }
    public String getNodeName() { return nodeName; }
    public void setNodeName(String nodeName) { this.nodeName = nodeName; }
    public String getTaskType() { return taskType; }
    public void setTaskType(String taskType) { this.taskType = taskType; }
    public Long getSysTaskId() { return sysTaskId; }
    public void setSysTaskId(Long sysTaskId) { this.sysTaskId = sysTaskId; }
    public Long getAssigneeId() { return assigneeId; }
    public void setAssigneeId(Long assigneeId) { this.assigneeId = assigneeId; }
    public String getAssigneeName() { return assigneeName; }
    public void setAssigneeName(String assigneeName) { this.assigneeName = assigneeName; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public LocalDateTime getDueDate() { return dueDate; }
    public void setDueDate(LocalDateTime dueDate) { this.dueDate = dueDate; }
    public String getActionResult() { return actionResult; }
    public void setActionResult(String actionResult) { this.actionResult = actionResult; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getCompletedAt() { return completedAt; }
    public void setCompletedAt(LocalDateTime completedAt) { this.completedAt = completedAt; }
}
