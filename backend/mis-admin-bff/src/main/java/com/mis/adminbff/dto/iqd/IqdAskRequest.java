package com.mis.adminbff.dto.iqd;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;

import java.util.List;

/**
 * 问数请求 DTO（与 Python {@code models/iqd_schema.py::AskRequest} 同构，§4.3）。
 *
 * <p>wire 字段 snake_case；BFF 只做透传 + 补充 {@code view}（按权限码裁定），
 * 其余字段原样转发给 Worker（ai-platform mis-iqd Agent）。
 */
public class IqdAskRequest {

    @NotBlank(message = "问题不能为空")
    private String question;

    /** 会话 id（前端会话持久化）。 */
    private String sessionId;

    /** 线程 id（多轮追问关联；可空）。 */
    private String threadId;

    /** 连接 id（指定数据源；空 = 主连接）。 */
    private Long connectionId;

    /** 视图（admin/user）；空 = 由 BFF 按权限裁定。 */
    private String view;

    /** 模拟角色码（测试用；可空）。 */
    private String simulateRoleCode;

    /** 范围提示（限定表集合 item_key；可空）。 */
    private List<String> scopeHint;

    /** 是否流式（ask-stream 固定 true）。 */
    private Boolean stream;

    public String getQuestion() {
        return question;
    }

    public void setQuestion(String question) {
        this.question = question;
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

    public Long getConnectionId() {
        return connectionId;
    }

    public void setConnectionId(Long connectionId) {
        this.connectionId = connectionId;
    }

    public String getView() {
        return view;
    }

    public void setView(String view) {
        this.view = view;
    }

    public String getSimulateRoleCode() {
        return simulateRoleCode;
    }

    public void setSimulateRoleCode(String simulateRoleCode) {
        this.simulateRoleCode = simulateRoleCode;
    }

    public List<String> getScopeHint() {
        return scopeHint;
    }

    public void setScopeHint(List<String> scopeHint) {
        this.scopeHint = scopeHint;
    }

    public Boolean getStream() {
        return stream;
    }

    public void setStream(Boolean stream) {
        this.stream = stream;
    }

    @JsonProperty("session_id")
    public String sessionIdWire() {
        return sessionId;
    }

    @JsonProperty("thread_id")
    public String threadIdWire() {
        return threadId;
    }

    @JsonProperty("connection_id")
    public Long connectionIdWire() {
        return connectionId;
    }

    @JsonProperty("simulate_role_code")
    public String simulateRoleCodeWire() {
        return simulateRoleCode;
    }

    @JsonProperty("scope_hint")
    public List<String> scopeHintWire() {
        return scopeHint;
    }
}
