package com.mis.taskflow.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * 流程节点 {@code wf_node}。
 *
 * <p>{@code nodeType}：START / APPROVAL / ROUTING / CONDITIONAL / AUTOMATION / END。
 * {@code assigneeRule} 为审批人规则 JSON。
 */
@Entity
@Table(name = "wf_node")
public class WfNode {

    public static final String TYPE_START = "START";
    public static final String TYPE_APPROVAL = "APPROVAL";
    public static final String TYPE_ROUTING = "ROUTING";
    public static final String TYPE_CONDITIONAL = "CONDITIONAL";
    public static final String TYPE_AUTOMATION = "AUTOMATION";
    public static final String TYPE_END = "END";

    @Id
    private Long id;

    @Column(name = "definition_id", nullable = false)
    private Long definitionId;

    @Column(name = "node_code", nullable = false, length = 64)
    private String nodeCode;

    @Column(name = "node_name", nullable = false, length = 128)
    private String nodeName;

    @Column(name = "node_type", nullable = false, length = 32)
    private String nodeType;

    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder = 0;

    @Column(name = "canvas_x")
    private Double canvasX;

    @Column(name = "canvas_y")
    private Double canvasY;

    @Column(name = "condition_expr", columnDefinition = "text")
    private String conditionExpr;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "assignee_rule", columnDefinition = "jsonb", nullable = false)
    private String assigneeRule = "{}";

    @Column(name = "timeout_hours")
    private Integer timeoutHours;

    @Column(name = "notify_template_id")
    private Long notifyTemplateId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private String config = "{}";

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getDefinitionId() { return definitionId; }
    public void setDefinitionId(Long definitionId) { this.definitionId = definitionId; }
    public String getNodeCode() { return nodeCode; }
    public void setNodeCode(String nodeCode) { this.nodeCode = nodeCode; }
    public String getNodeName() { return nodeName; }
    public void setNodeName(String nodeName) { this.nodeName = nodeName; }
    public String getNodeType() { return nodeType; }
    public void setNodeType(String nodeType) { this.nodeType = nodeType; }
    public Integer getSortOrder() { return sortOrder; }
    public void setSortOrder(Integer sortOrder) { this.sortOrder = sortOrder; }
    public Double getCanvasX() { return canvasX; }
    public void setCanvasX(Double canvasX) { this.canvasX = canvasX; }
    public Double getCanvasY() { return canvasY; }
    public void setCanvasY(Double canvasY) { this.canvasY = canvasY; }
    public String getConditionExpr() { return conditionExpr; }
    public void setConditionExpr(String conditionExpr) { this.conditionExpr = conditionExpr; }
    public String getAssigneeRule() { return assigneeRule; }
    public void setAssigneeRule(String assigneeRule) { this.assigneeRule = assigneeRule; }
    public Integer getTimeoutHours() { return timeoutHours; }
    public void setTimeoutHours(Integer timeoutHours) { this.timeoutHours = timeoutHours; }
    public Long getNotifyTemplateId() { return notifyTemplateId; }
    public void setNotifyTemplateId(Long notifyTemplateId) { this.notifyTemplateId = notifyTemplateId; }
    public String getConfig() { return config; }
    public void setConfig(String config) { this.config = config; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
