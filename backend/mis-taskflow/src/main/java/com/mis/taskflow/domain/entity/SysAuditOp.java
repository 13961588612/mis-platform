package com.mis.taskflow.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * 业务语义化操作审计 {@code sys_audit_op}。
 *
 * <p>与 {@code sys_oper_log}（HTTP 轨迹）互补：本表记录「谁对什么业务做了什么、变更了什么」，
 * 提供结构化 before/after 快照与 diff 摘要，前端可直接渲染为人类可读的表格与对比视图。
 *
 * <p>见 docs/architecture/msg-log-workflow/02-operational-logging-design.md。
 */
@Entity
@Table(name = "sys_audit_op")
public class SysAuditOp {

    /** 结果状态：成功。 */
    public static final String SUCCESS = "SUCCESS";
    /** 结果状态：失败。 */
    public static final String FAIL = "FAIL";
    /** 结果状态：部分成功。 */
    public static final String PARTIAL = "PARTIAL";

    @Id
    private Long id;

    @Column(name = "tenant_id", nullable = false)
    private Long tenantId;

    @Column(name = "user_id")
    private Long userId;

    @Column(length = 64)
    private String username;

    @Column(length = 64)
    private String module;

    @Column(name = "operation_type", nullable = false, length = 32)
    private String operationType;

    @Column(name = "business_type", length = 64)
    private String businessType;

    @Column(name = "business_id", length = 128)
    private String businessId;

    @Column(length = 512)
    private String description;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "before_data", columnDefinition = "jsonb", nullable = false)
    private String beforeData = "{}";

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "after_data", columnDefinition = "jsonb", nullable = false)
    private String afterData = "{}";

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "diff_summary", columnDefinition = "jsonb", nullable = false)
    private String diffSummary = "[]";

    @Column(name = "trace_id", length = 64)
    private String traceId;

    @Column(name = "http_log_id")
    private Long httpLogId;

    @Column(name = "result_status", nullable = false, length = 16)
    private String resultStatus = SUCCESS;

    @Column(name = "error_msg", columnDefinition = "text")
    private String errorMsg;

    @Column(name = "duration_ms")
    private Integer durationMs;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "extra_context", columnDefinition = "jsonb", nullable = false)
    private String extraContext = "{}";

    @Column(name = "oper_time", nullable = false)
    private LocalDateTime operTime;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getTenantId() { return tenantId; }
    public void setTenantId(Long tenantId) { this.tenantId = tenantId; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }
    public String getModule() { return module; }
    public void setModule(String module) { this.module = module; }
    public String getOperationType() { return operationType; }
    public void setOperationType(String operationType) { this.operationType = operationType; }
    public String getBusinessType() { return businessType; }
    public void setBusinessType(String businessType) { this.businessType = businessType; }
    public String getBusinessId() { return businessId; }
    public void setBusinessId(String businessId) { this.businessId = businessId; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public String getBeforeData() { return beforeData; }
    public void setBeforeData(String beforeData) { this.beforeData = beforeData; }
    public String getAfterData() { return afterData; }
    public void setAfterData(String afterData) { this.afterData = afterData; }
    public String getDiffSummary() { return diffSummary; }
    public void setDiffSummary(String diffSummary) { this.diffSummary = diffSummary; }
    public String getTraceId() { return traceId; }
    public void setTraceId(String traceId) { this.traceId = traceId; }
    public Long getHttpLogId() { return httpLogId; }
    public void setHttpLogId(Long httpLogId) { this.httpLogId = httpLogId; }
    public String getResultStatus() { return resultStatus; }
    public void setResultStatus(String resultStatus) { this.resultStatus = resultStatus; }
    public String getErrorMsg() { return errorMsg; }
    public void setErrorMsg(String errorMsg) { this.errorMsg = errorMsg; }
    public Integer getDurationMs() { return durationMs; }
    public void setDurationMs(Integer durationMs) { this.durationMs = durationMs; }
    public String getExtraContext() { return extraContext; }
    public void setExtraContext(String extraContext) { this.extraContext = extraContext; }
    public LocalDateTime getOperTime() { return operTime; }
    public void setOperTime(LocalDateTime operTime) { this.operTime = operTime; }
}