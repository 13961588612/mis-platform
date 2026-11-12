package com.mis.iqd.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * 问数审计日志（iqd_ask_log）——「谁问了什么、见了什么、结果如何」全链路留痕。
 *
 * <p>{@code sql_text} 记录<b>注入行级范围后的最终 SQL</b>；{@code resolved_scope}
 * JSONB 记 {@code {"row_scope": {"injected": {table: pred}, "verdict": "allow|deny",
 * "original_sql": "..."}}（v1.9 增补 strategy/dimensions）；{@code wren_status_trail}
 * JSONB 记 WrenAI 状态轨迹；{@code view_mode} 记 user/admin 视图（admin 需 iqd:trace:view）。
 */
@Entity
@Table(name = "iqd_ask_log")
public class IqdAskLog {

    @Id
    private Long id;

    @Column(name = "trace_id")
    private String traceId;

    @Column(name = "session_id")
    private String sessionId;

    @Column(name = "thread_id")
    private String threadId;

    @Column(name = "query_id")
    private String queryId;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "employee_id")
    private String employeeId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "role_codes", columnDefinition = "jsonb")
    private String roleCodes;

    @Column(columnDefinition = "text")
    private String question;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "resolved_scope", columnDefinition = "jsonb")
    private String resolvedScope;

    @Column
    private String status;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "wren_status_trail", columnDefinition = "jsonb")
    private String wrenStatusTrail;

    @Column(name = "sql_text", columnDefinition = "text")
    private String sqlText;

    @Column(name = "sql_dialect")
    private String sqlDialect;

    @Column(columnDefinition = "text")
    private String summary;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private String citations;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "plan_steps", columnDefinition = "jsonb")
    private String planSteps;

    @Column(name = "row_count")
    private Integer rowCount;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "masked_columns", columnDefinition = "jsonb")
    private String maskedColumns;

    @Column(name = "latency_ms")
    private Long latencyMs;

    @Column(name = "error_code")
    private String errorCode;

    @Column(name = "error_message")
    private String errorMessage;

    @Column(name = "view_mode", nullable = false)
    private String viewMode = "user";

    /** 模拟角色码（B6 后台测试页；无模拟为 null，仅审计留痕不参与判权）。 */
    @Column(name = "simulated_role_code")
    private String simulatedRoleCode;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getTraceId() {
        return traceId;
    }

    public void setTraceId(String traceId) {
        this.traceId = traceId;
    }

    public String getSessionId() {
        return sessionId;
    }

    public void setSessionId(String sessionId) {
        this.sessionId = sessionId;
    }

    public String getThreadId() {
        return threadId;
    }

    public void setThreadId(String threadId) {
        this.threadId = threadId;
    }

    public String getQueryId() {
        return queryId;
    }

    public void setQueryId(String queryId) {
        this.queryId = queryId;
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public String getEmployeeId() {
        return employeeId;
    }

    public void setEmployeeId(String employeeId) {
        this.employeeId = employeeId;
    }

    public String getRoleCodes() {
        return roleCodes;
    }

    public void setRoleCodes(String roleCodes) {
        this.roleCodes = roleCodes;
    }

    public String getQuestion() {
        return question;
    }

    public void setQuestion(String question) {
        this.question = question;
    }

    public String getResolvedScope() {
        return resolvedScope;
    }

    public void setResolvedScope(String resolvedScope) {
        this.resolvedScope = resolvedScope;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getWrenStatusTrail() {
        return wrenStatusTrail;
    }

    public void setWrenStatusTrail(String wrenStatusTrail) {
        this.wrenStatusTrail = wrenStatusTrail;
    }

    public String getSqlText() {
        return sqlText;
    }

    public void setSqlText(String sqlText) {
        this.sqlText = sqlText;
    }

    public String getSqlDialect() {
        return sqlDialect;
    }

    public void setSqlDialect(String sqlDialect) {
        this.sqlDialect = sqlDialect;
    }

    public String getSummary() {
        return summary;
    }

    public void setSummary(String summary) {
        this.summary = summary;
    }

    public String getCitations() {
        return citations;
    }

    public void setCitations(String citations) {
        this.citations = citations;
    }

    public String getPlanSteps() {
        return planSteps;
    }

    public void setPlanSteps(String planSteps) {
        this.planSteps = planSteps;
    }

    public Integer getRowCount() {
        return rowCount;
    }

    public void setRowCount(Integer rowCount) {
        this.rowCount = rowCount;
    }

    public String getMaskedColumns() {
        return maskedColumns;
    }

    public void setMaskedColumns(String maskedColumns) {
        this.maskedColumns = maskedColumns;
    }

    public Long getLatencyMs() {
        return latencyMs;
    }

    public void setLatencyMs(Long latencyMs) {
        this.latencyMs = latencyMs;
    }

    public String getErrorCode() {
        return errorCode;
    }

    public void setErrorCode(String errorCode) {
        this.errorCode = errorCode;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public void setErrorMessage(String errorMessage) {
        this.errorMessage = errorMessage;
    }

    public String getViewMode() {
        return viewMode;
    }

    public void setViewMode(String viewMode) {
        this.viewMode = viewMode;
    }

    public String getSimulatedRoleCode() {
        return simulatedRoleCode;
    }

    public void setSimulatedRoleCode(String simulatedRoleCode) {
        this.simulatedRoleCode = simulatedRoleCode;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
