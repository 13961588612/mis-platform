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

    /**
     * 关联用户视角的 {@link SysTask#id}（纯流程任务可为空）。
     *
     * <p><b>⚠️ 本字段「不是唯一键」——它既无唯一约束也无外键，用它JOIN 时不能假设
     * 「一个 sysTask 只对应一个 wfTask」。</b>
     *
     * <p><b>为什么</b>：同一个 {@code sysTask} 会被<strong>同一实例</strong>的多个
     * {@code wfTask} 节点共享。实测例子：{@code sys_task 960122} 同时被
     * {@code wf_task 960112}（start 节点）与 {@code wf_task 960113}（approve 节点）指向。
     *
     * <p><b>后果（写JOIN / 回填时必读）</b>：以 {@code wf_task.sys_task_id = sys_task.id}
     * 做多行匹配时，{@code UPDATE ... FROM} 会<strong>取任意一行</strong>（无序，不保证取哪条）。
     * 因此：
     * <ul>
     *   <li>当前数据下各匹配行的 {@code instanceId} 一致，取任意一行等价于取确定值；</li>
     *   <li>但若将来出现同一个 {@code sysTask} 关联到<strong>不同</strong> instance 的脏数据，
     *       就会取到任意一个 ⇒ 属<strong>错数据</strong>（写进去的仍是某个真实存在的
     *       instanceId，且只影响 metadata 里的一个键，不破坏其它键），<strong>不是数据损坏</strong>。</li>
     * </ul>
     *
     * <p><b>「当前各匹配行 instanceId 一致」是数据事实，不是数据库约束保证</b>——
     * 实测范围：截至 2026-10-11，测试库该不变式 0 行违反（见 {@code V135} 迁移文件末尾
     * 第 4 条自检查询）。<b>不要把它当成有DB 兜底。</b>
     *
     * <p><b>彻底消除该风险需DB 级约束</b>：对 {@code (sys_task_id, instance_id)} 建唯一索引，
     * 或给 {@code sys_task_id} 补外键 + 一对一约束。<b>本轮未做，属技术债</b>——
     * 在补约束之前，若要写入跨实例的脏数据，应先加约束。
     */
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
