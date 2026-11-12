package com.mis.taskflow.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/**
 * 流程边 {@code wf_edge}（P7+ 图式流转）。
 *
 * <p>设计器画布上的连线；后端据此在节点间流转，支持条件分支（一个源多个出口）。
 */
@Entity
@Table(name = "wf_edge")
public class WfEdge {

    public static final String TYPE_DEFAULT = "DEFAULT";
    public static final String TYPE_CONDITION_YES = "CONDITION_YES";
    public static final String TYPE_CONDITION_NO = "CONDITION_NO";
    public static final String TYPE_REJECT = "REJECT";

    @Id
    private Long id;

    @Column(name = "definition_id", nullable = false)
    private Long definitionId;

    @Column(name = "source_node", nullable = false, length = 64)
    private String sourceNode;

    @Column(name = "target_node", nullable = false, length = 64)
    private String targetNode;

    @Column(name = "edge_type", nullable = false, length = 16)
    private String edgeType = TYPE_DEFAULT;

    @Column(length = 128)
    private String label;

    @Column(name = "condition_expr", columnDefinition = "text")
    private String conditionExpr;

    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder = 0;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getDefinitionId() { return definitionId; }
    public void setDefinitionId(Long definitionId) { this.definitionId = definitionId; }
    public String getSourceNode() { return sourceNode; }
    public void setSourceNode(String sourceNode) { this.sourceNode = sourceNode; }
    public String getTargetNode() { return targetNode; }
    public void setTargetNode(String targetNode) { this.targetNode = targetNode; }
    public String getEdgeType() { return edgeType; }
    public void setEdgeType(String edgeType) { this.edgeType = edgeType; }
    public String getLabel() { return label; }
    public void setLabel(String label) { this.label = label; }
    public String getConditionExpr() { return conditionExpr; }
    public void setConditionExpr(String conditionExpr) { this.conditionExpr = conditionExpr; }
    public Integer getSortOrder() { return sortOrder; }
    public void setSortOrder(Integer sortOrder) { this.sortOrder = sortOrder; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
