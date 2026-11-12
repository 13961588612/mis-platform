package com.mis.adminbff.dto.iqd;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;

import java.util.List;
import java.util.Map;

/**
 * 问数响应 DTO（与 Python {@code models/iqd_schema.py::AskResponse} 同构，§4.3）。
 *
 * <p>wire 字段 snake_case；result 帧为 SSE 唯一权威终态（§7.3）。
 * {@code plan[].sql} 与顶层 {@code sql} 在 view=user 时由 Worker 投影剥键，
 * BFF 侧只透传不加工。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class IqdAskResponse {

    private String queryId;
    private String threadId;
    private String agentId;
    private String status;
    /** Worker/LLM 偶发用 answer；契约字段为 answer_summary。 */
    @JsonAlias({"answer", "answer_summary"})
    private String answerSummary;
    private String sql;
    private String sqlDialect;
    private IqdResultData data;
    private List<IqdCitation> citations;
    /**
     * plan 为 {@code List<IqdPlanStep>}，反序列化器须套到 List 的【每个元素】上，
     * 故使用 {@code contentUsing}（非 {@code using}）。
     * {@code using} 会把这个反序列化器套到【整个 List】上，导致二次包裹，
     * 进而在序列化阶段对 ArrayList 元素调用 IqdPlanStep 的 getter 反射非 IqdPlanStep
     * 对象而抛出 "object is not an instance of declaring class"。
     */
    @JsonDeserialize(contentUsing = IqdPlanStepListDeserializer.class)
    private List<IqdPlanStep> plan;
    private IqdScopeResolutionPayload scope;
    private List<String> maskedColumns = List.of();
    private Long latencyMs;
    private String errorCode;
    private String errorMessage;
    /** admin 视图：NL→SQL LLM 入参/出参；user 视图由 Worker 投影删除。 */
    @JsonProperty("nl2sql_debug")
    private Map<String, Object> nl2sqlDebug;

    public String getQueryId() {
        return queryId;
    }

    public void setQueryId(String queryId) {
        this.queryId = queryId;
    }

    public String getThreadId() {
        return threadId;
    }

    public void setThreadId(String threadId) {
        this.threadId = threadId;
    }

    public String getAgentId() {
        return agentId;
    }

    public void setAgentId(String agentId) {
        this.agentId = agentId;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getAnswerSummary() {
        return answerSummary;
    }

    public void setAnswerSummary(String answerSummary) {
        this.answerSummary = answerSummary;
    }

    public String getSql() {
        return sql;
    }

    public void setSql(String sql) {
        this.sql = sql;
    }

    public String getSqlDialect() {
        return sqlDialect;
    }

    public void setSqlDialect(String sqlDialect) {
        this.sqlDialect = sqlDialect;
    }

    public IqdResultData getData() {
        return data;
    }

    public void setData(IqdResultData data) {
        this.data = data;
    }

    public List<IqdCitation> getCitations() {
        return citations;
    }

    public void setCitations(List<IqdCitation> citations) {
        this.citations = citations;
    }

    public List<IqdPlanStep> getPlan() {
        return plan;
    }

    public void setPlan(List<IqdPlanStep> plan) {
        this.plan = plan;
    }

    public IqdScopeResolutionPayload getScope() {
        return scope;
    }

    public void setScope(IqdScopeResolutionPayload scope) {
        this.scope = scope;
    }

    @JsonProperty("masked_columns")
    public List<String> getMaskedColumns() {
        return maskedColumns != null ? maskedColumns : List.of();
    }

    @JsonProperty("masked_columns")
    public void setMaskedColumns(List<String> maskedColumns) {
        // Worker / LLM 常回 null；仅有 wire getter 时 Jackson setterless 遇 null 抛 45299
        this.maskedColumns = maskedColumns != null ? maskedColumns : List.of();
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

    public Map<String, Object> getNl2sqlDebug() {
        return nl2sqlDebug;
    }

    public void setNl2sqlDebug(Map<String, Object> nl2sqlDebug) {
        this.nl2sqlDebug = nl2sqlDebug;
    }

    @JsonProperty("query_id")
    public String queryIdWire() {
        return queryId;
    }

    @JsonProperty("thread_id")
    public String threadIdWire() {
        return threadId;
    }

    @JsonProperty("agent_id")
    public String agentIdWire() {
        return agentId;
    }

    @JsonProperty("answer_summary")
    public String answerSummaryWire() {
        return answerSummary;
    }

    @JsonProperty("sql_dialect")
    public String sqlDialectWire() {
        return sqlDialect;
    }

    @JsonProperty("latency_ms")
    public Long latencyMsWire() {
        return latencyMs;
    }

    @JsonProperty("error_code")
    public String errorCodeWire() {
        return errorCode;
    }

    @JsonProperty("error_message")
    public String errorMessageWire() {
        return errorMessage;
    }
}
