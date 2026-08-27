package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 连接配置响应视图（GET /api/v1/iqd/config；密钥恒回 ******）。
 *
 * <p>wire 字段 snake_case（与 Python :class:`ConnectionConfig` 同构，§4.3/§7.6）。
 */
public class IqdConnectionVO {

    private Long id;
    private String name;
    private String baseUrl;
    private String authType;
    /** 恒回 ******（不泄露 secret_ref 真值）。 */
    private String secretRef = "******";
    private String projectId;
    private String defaultConnector;
    private Integer timeoutSeconds;
    private String language;
    private String status;
    private Instant lastHealthAt;
    private String lastHealthMsg;
    private Boolean enabled;
    /** 按连接灰度闸门：是否允许平台写回 MDL（二期 P0-1~P0-12，U7/Q4）。 */
    private Boolean mdlWritebackEnabled;

    /** 【方案A·多连接】WrenAI MCP 进程状态（running/stopped/starting/crashed/unhealthy）。 */
    private String mcpStatus;

    /** 【方案A·多连接】WrenAI MCP 进程监听端口。 */
    private Integer mcpPort;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    public String getAuthType() {
        return authType;
    }

    public void setAuthType(String authType) {
        this.authType = authType;
    }

    public String getSecretRef() {
        return secretRef;
    }

    public void setSecretRef(String secretRef) {
        this.secretRef = secretRef;
    }

    public String getProjectId() {
        return projectId;
    }

    public void setProjectId(String projectId) {
        this.projectId = projectId;
    }

    public String getDefaultConnector() {
        return defaultConnector;
    }

    public void setDefaultConnector(String defaultConnector) {
        this.defaultConnector = defaultConnector;
    }

    public Integer getTimeoutSeconds() {
        return timeoutSeconds;
    }

    public void setTimeoutSeconds(Integer timeoutSeconds) {
        this.timeoutSeconds = timeoutSeconds;
    }

    public String getLanguage() {
        return language;
    }

    public void setLanguage(String language) {
        this.language = language;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public Instant getLastHealthAt() {
        return lastHealthAt;
    }

    public void setLastHealthAt(Instant lastHealthAt) {
        this.lastHealthAt = lastHealthAt;
    }

    public String getLastHealthMsg() {
        return lastHealthMsg;
    }

    public void setLastHealthMsg(String lastHealthMsg) {
        this.lastHealthMsg = lastHealthMsg;
    }

    public Boolean getEnabled() {
        return enabled;
    }

    public void setEnabled(Boolean enabled) {
        this.enabled = enabled;
    }

    public Boolean getMdlWritebackEnabled() {
        return mdlWritebackEnabled;
    }

    public void setMdlWritebackEnabled(Boolean mdlWritebackEnabled) {
        this.mdlWritebackEnabled = mdlWritebackEnabled;
    }

    public String getMcpStatus() {
        return mcpStatus;
    }

    public void setMcpStatus(String mcpStatus) {
        this.mcpStatus = mcpStatus;
    }

    public Integer getMcpPort() {
        return mcpPort;
    }

    public void setMcpPort(Integer mcpPort) {
        this.mcpPort = mcpPort;
    }

    @JsonProperty("base_url")
    public String baseUrlWire() {
        return baseUrl;
    }

    @JsonProperty("secret_ref")
    public String secretRefWire() {
        return secretRef;
    }

    @JsonProperty("project_id")
    public String projectIdWire() {
        return projectId;
    }

    @JsonProperty("default_connector")
    public String defaultConnectorWire() {
        return defaultConnector;
    }

    @JsonProperty("timeout_seconds")
    public Integer timeoutSecondsWire() {
        return timeoutSeconds;
    }

    @JsonProperty("last_health_at")
    public Instant lastHealthAtWire() {
        return lastHealthAt;
    }

    @JsonProperty("last_health_msg")
    public String lastHealthMsgWire() {
        return lastHealthMsg;
    }

    @JsonProperty("mdl_writeback_enabled")
    public Boolean mdlWritebackEnabledWire() {
        return mdlWritebackEnabled;
    }

    @JsonProperty("mcp_status")
    public String mcpStatusWire() {
        return mcpStatus;
    }

    @JsonProperty("mcp_port")
    public Integer mcpPortWire() {
        return mcpPort;
    }

    /** 兼容旧调用方的 camelCase 视图（非 wire 主形态，仅内部用）。 */
    public Map<String, Object> toMap() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("name", name);
        m.put("baseUrl", baseUrl);
        m.put("authType", authType);
        m.put("secretRef", secretRef);
        m.put("projectId", projectId);
        m.put("defaultConnector", defaultConnector);
        m.put("timeoutSeconds", timeoutSeconds);
        m.put("language", language);
        m.put("status", status);
        m.put("lastHealthAt", lastHealthAt);
        m.put("lastHealthMsg", lastHealthMsg);
        m.put("enabled", enabled);
        return m;
    }
}
