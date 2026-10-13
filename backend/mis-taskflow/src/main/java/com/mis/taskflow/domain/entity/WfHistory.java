package com.mis.taskflow.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/**
 * 流程历史 {@code wf_history}。
 */
@Entity
@Table(name = "wf_history")
public class WfHistory {

    public static final String OP_SUBMIT = "SUBMIT";
    public static final String OP_APPROVE = "APPROVE";
    public static final String OP_REJECT = "REJECT";
    public static final String OP_FORWARD = "FORWARD";
    public static final String OP_SKIP = "SKIP";
    /** 抄送节点已投递（不阻塞流程）。 */
    public static final String OP_CC_DISPATCH = "CC_DISPATCH";
    /** 纯评论：由「消息回复」回写（PR-18），不改变流程状态、不推进节点。 */
    public static final String OP_COMMENT = "COMMENT";

    @Id
    private Long id;

    @Column(name = "instance_id", nullable = false)
    private Long instanceId;

    @Column(name = "node_code", nullable = false, length = 64)
    private String nodeCode;

    @Column(name = "operator_id")
    private Long operatorId;

    @Column(name = "operator_name", length = 64)
    private String operatorName;

    @Column(nullable = false, length = 32)
    private String operation;

    @Column(name = "from_node", length = 64)
    private String fromNode;

    @Column(name = "to_node", length = 64)
    private String toNode;

    @Column(columnDefinition = "text")
    private String comment;

    @Column(name = "duration_seconds")
    private Double durationSeconds;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getInstanceId() { return instanceId; }
    public void setInstanceId(Long instanceId) { this.instanceId = instanceId; }
    public String getNodeCode() { return nodeCode; }
    public void setNodeCode(String nodeCode) { this.nodeCode = nodeCode; }
    public Long getOperatorId() { return operatorId; }
    public void setOperatorId(Long operatorId) { this.operatorId = operatorId; }
    public String getOperatorName() { return operatorName; }
    public void setOperatorName(String operatorName) { this.operatorName = operatorName; }
    public String getOperation() { return operation; }
    public void setOperation(String operation) { this.operation = operation; }
    public String getFromNode() { return fromNode; }
    public void setFromNode(String fromNode) { this.fromNode = fromNode; }
    public String getToNode() { return toNode; }
    public void setToNode(String toNode) { this.toNode = toNode; }
    public String getComment() { return comment; }
    public void setComment(String comment) { this.comment = comment; }
    public Double getDurationSeconds() { return durationSeconds; }
    public void setDurationSeconds(Double durationSeconds) { this.durationSeconds = durationSeconds; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
