package com.mis.adminbff.dto.iqd;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;

/**
 * 问数审计日志响应 VO（BFF → 前端 /traces；snake_case wire）。
 *
 * <p>{@code sql_text} 为注入行级范围后的最终 SQL；admin 视图（iqd:trace:view）才有
 * SQL 相关字段（user 视图由 Worker 投影剥键，BFF 不回填）。
 */
public class IqdAskLogVO {

    private Long id;
    private String traceId;
    private String sessionId;
    private String threadId;
    private String queryId;
    private Long userId;
    private String employeeId;
    private String roleCodes;
    private String question;
    private String resolvedScope;
    private String status;
    private String wrenStatusTrail;
    private String sqlText;
    private String sqlDialect;
    private String summary;
    private String citations;
    private String planSteps;
    private Integer rowCount;
    private String maskedColumns;
    private Long latencyMs;
    private String errorCode;
    private String errorMessage;
    private String viewMode;
    private Instant createdAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    @JsonProperty("trace_id")
    public String getTraceId() {
        return traceId;
    }

    public void setTraceId(String traceId) {
        this.traceId = traceId;
    }

    @JsonProperty("session_id")
    public String getSessionId() {
        return sessionId;
    }

    public void setSessionId(String sessionId) {
        this.sessionId = sessionId;
    }

    @JsonProperty("thread_id")
    public String getThreadId() {
        return threadId;
    }

    public void setThreadId(String threadId) {
        this.threadId = threadId;
    }

    @JsonProperty("query_id")
    public String getQueryId() {
        return queryId;
    }

    public void setQueryId(String queryId) {
        this.queryId = queryId;
    }

    @JsonProperty("user_id")
    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    @JsonProperty("employee_id")
    public String getEmployeeId() {
        return employeeId;
    }

    public void setEmployeeId(String employeeId) {
        this.employeeId = employeeId;
    }

    @JsonProperty("role_codes")
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

    @JsonProperty("resolved_scope")
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

    @JsonProperty("wren_status_trail")
    public String getWrenStatusTrail() {
        return wrenStatusTrail;
    }

    public void setWrenStatusTrail(String wrenStatusTrail) {
        this.wrenStatusTrail = wrenStatusTrail;
    }

    @JsonProperty("sql_text")
    public String getSqlText() {
        return sqlText;
    }

    public void setSqlText(String sqlText) {
        this.sqlText = sqlText;
    }

    @JsonProperty("sql_dialect")
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

    @JsonProperty("plan_steps")
    public String getPlanSteps() {
        return planSteps;
    }

    public void setPlanSteps(String planSteps) {
        this.planSteps = planSteps;
    }

    @JsonProperty("row_count")
    public Integer getRowCount() {
        return rowCount;
    }

    public void setRowCount(Integer rowCount) {
        this.rowCount = rowCount;
    }

    @JsonProperty("masked_columns")
    public String getMaskedColumns() {
        return maskedColumns;
    }

    public void setMaskedColumns(String maskedColumns) {
        this.maskedColumns = maskedColumns;
    }

    @JsonProperty("latency_ms")
    public Long getLatencyMs() {
        return latencyMs;
    }

    public void setLatencyMs(Long latencyMs) {
        this.latencyMs = latencyMs;
    }

    @JsonProperty("error_code")
    public String getErrorCode() {
        return errorCode;
    }

    public void setErrorCode(String errorCode) {
        this.errorCode = errorCode;
    }

    @JsonProperty("error_message")
    public String getErrorMessage() {
        return errorMessage;
    }

    public void setErrorMessage(String errorMessage) {
        this.errorMessage = errorMessage;
    }

    @JsonProperty("view_mode")
    public String getViewMode() {
        return viewMode;
    }

    public void setViewMode(String viewMode) {
        this.viewMode = viewMode;
    }

    @JsonProperty("created_at")
    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}
