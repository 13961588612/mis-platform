package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
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

    /** 【分层 2026-09-29】所属数据库连接配置（iqd_db_profile.id）；project : profile = N : 1。 */
    private Long profileId;

    /** 【分层】profile 名（列表直接展示，免二次查询）。 */
    private String profileName;

    /** 【路线 A】业务库类型（非敏感展示；密码只在 vault）。 */
    private String dbType;

    /** 【路线 A】业务库 host（非敏感展示）。 */
    private String dbHost;

    /** 【路线 A】业务库 port（非敏感展示）。 */
    private Integer dbPort;

    /** 【路线 A】业务库 database（非敏感展示）。 */
    private String dbDatabase;

    /** 【路线 A】业务库账号（非敏感展示；密码不回）。 */
    private String dbUser;

    /** 【路线 A】是否已在 ai-platform vault 存有该连接的凭据（编辑时提示是否需重填密码）。 */
    private Boolean hasDbPassword;

    /** 【方案A·多连接】WrenAI MCP 进程状态（running/stopped/starting/crashed/unhealthy）。 */
    private String mcpStatus;

    /** 【方案A·多连接】WrenAI MCP 进程监听端口。 */
    private Integer mcpPort;

    /** 【方案A·跨机器落地 v0.2】WrenAI MCP 数据面可达 host（ai-platform 侧视角）。 */
    private String mcpHost;

    /** 【方案A·跨机器落地 v0.2】WrenMcpAgent 部署句柄（agent_handle）。 */
    private String agentHandle;

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

    public Long getProfileId() {
        return profileId;
    }

    public void setProfileId(Long profileId) {
        this.profileId = profileId;
    }

    public String getProfileName() {
        return profileName;
    }

    public void setProfileName(String profileName) {
        this.profileName = profileName;
    }

    public String getDbType() {
        return dbType;
    }

    public void setDbType(String dbType) {
        this.dbType = dbType;
    }

    public String getDbHost() {
        return dbHost;
    }

    public void setDbHost(String dbHost) {
        this.dbHost = dbHost;
    }

    public Integer getDbPort() {
        return dbPort;
    }

    public void setDbPort(Integer dbPort) {
        this.dbPort = dbPort;
    }

    public String getDbDatabase() {
        return dbDatabase;
    }

    public void setDbDatabase(String dbDatabase) {
        this.dbDatabase = dbDatabase;
    }

    public String getDbUser() {
        return dbUser;
    }

    public void setDbUser(String dbUser) {
        this.dbUser = dbUser;
    }

    public Boolean getHasDbPassword() {
        return hasDbPassword;
    }

    public void setHasDbPassword(Boolean hasDbPassword) {
        this.hasDbPassword = hasDbPassword;
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

    @JsonIgnore
    public String getMcpHost() {
        return mcpHost;
    }

    public void setMcpHost(String mcpHost) {
        this.mcpHost = mcpHost;
    }

    @JsonIgnore
    public String getAgentHandle() {
        return agentHandle;
    }

    public void setAgentHandle(String agentHandle) {
        this.agentHandle = agentHandle;
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

    @JsonProperty("profile_id")
    public Long profileIdWire() {
        return profileId;
    }

    @JsonProperty("profile_name")
    public String profileNameWire() {
        return profileName;
    }

    @JsonProperty("db_type")
    public String dbTypeWire() {
        return dbType;
    }

    @JsonProperty("db_host")
    public String dbHostWire() {
        return dbHost;
    }

    @JsonProperty("db_port")
    public Integer dbPortWire() {
        return dbPort;
    }

    @JsonProperty("db_database")
    public String dbDatabaseWire() {
        return dbDatabase;
    }

    @JsonProperty("db_user")
    public String dbUserWire() {
        return dbUser;
    }

    @JsonProperty("has_db_password")
    public Boolean hasDbPasswordWire() {
        return hasDbPassword;
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
