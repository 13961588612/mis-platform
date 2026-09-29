package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * 连接配置保存请求（PUT /api/v1/iqd/config）。
 *
 * <p>密钥提交规则：``secretRef`` 非空才更新；空值/占位符（``******``）表示保留原值。
 * 平台库只存 profile 名/连接标识，**不存 WrenAI 凭证**（凭证由 wren profile 注入主机）。
 *
 * <p>wire 一律 snake_case：{@code @JsonProperty} 必须挂在 <b>getter + setter</b> 上，
 * 仅挂只读 {@code *Wire()} 会导致反序列化丢字段（前端传 {@code base_url} → 落库 null）。
 */
public class IqdConnectionSaveRequest {

    @NotBlank(message = "连接名称不能为空")
    private String name;

    private String baseUrl;

    private String authType = "none";

    /** 密钥引用；提交非空才更新（空 = 保留原值；GET 恒回 ******）。 */
    private String secretRef;

    private String projectId;

    private String defaultConnector;

    @NotNull(message = "超时秒数不能为空")
    private Integer timeoutSeconds = 60;

    private String language = "zh-CN";

    private Boolean enabled = true;

    /** 是否允许平台写回 MDL（U7/Q4）；缺省按 false 处理。 */
    private Boolean mdlWritebackEnabled;

    // ---- 路线 A：业务库连接（**非敏感展示字段**；密码只在 ai-platform vault）----
    /** 业务库类型（starrocks/mysql/postgres/...）。 */
    private String dbType;
    private String dbHost;
    private Integer dbPort;
    private String dbDatabase;
    private String dbUser;

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    @JsonProperty("base_url")
    public String getBaseUrl() {
        return baseUrl;
    }

    @JsonProperty("base_url")
    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    @JsonProperty("auth_type")
    public String getAuthType() {
        return authType;
    }

    @JsonProperty("auth_type")
    public void setAuthType(String authType) {
        this.authType = authType;
    }

    @JsonProperty("secret_ref")
    public String getSecretRef() {
        return secretRef;
    }

    @JsonProperty("secret_ref")
    public void setSecretRef(String secretRef) {
        this.secretRef = secretRef;
    }

    @JsonProperty("project_id")
    public String getProjectId() {
        return projectId;
    }

    @JsonProperty("project_id")
    public void setProjectId(String projectId) {
        this.projectId = projectId;
    }

    @JsonProperty("default_connector")
    public String getDefaultConnector() {
        return defaultConnector;
    }

    @JsonProperty("default_connector")
    public void setDefaultConnector(String defaultConnector) {
        this.defaultConnector = defaultConnector;
    }

    @JsonProperty("timeout_seconds")
    public Integer getTimeoutSeconds() {
        return timeoutSeconds;
    }

    @JsonProperty("timeout_seconds")
    public void setTimeoutSeconds(Integer timeoutSeconds) {
        this.timeoutSeconds = timeoutSeconds;
    }

    public String getLanguage() {
        return language;
    }

    public void setLanguage(String language) {
        this.language = language;
    }

    public Boolean getEnabled() {
        return enabled;
    }

    public void setEnabled(Boolean enabled) {
        this.enabled = enabled;
    }

    @JsonProperty("mdl_writeback_enabled")
    public Boolean getMdlWritebackEnabled() {
        return mdlWritebackEnabled;
    }

    @JsonProperty("mdl_writeback_enabled")
    public void setMdlWritebackEnabled(Boolean mdlWritebackEnabled) {
        this.mdlWritebackEnabled = mdlWritebackEnabled;
    }

    @JsonProperty("db_type")
    public String getDbType() {
        return dbType;
    }

    @JsonProperty("db_type")
    public void setDbType(String dbType) {
        this.dbType = dbType;
    }

    @JsonProperty("db_host")
    public String getDbHost() {
        return dbHost;
    }

    @JsonProperty("db_host")
    public void setDbHost(String dbHost) {
        this.dbHost = dbHost;
    }

    @JsonProperty("db_port")
    public Integer getDbPort() {
        return dbPort;
    }

    @JsonProperty("db_port")
    public void setDbPort(Integer dbPort) {
        this.dbPort = dbPort;
    }

    @JsonProperty("db_database")
    public String getDbDatabase() {
        return dbDatabase;
    }

    @JsonProperty("db_database")
    public void setDbDatabase(String dbDatabase) {
        this.dbDatabase = dbDatabase;
    }

    @JsonProperty("db_user")
    public String getDbUser() {
        return dbUser;
    }

    @JsonProperty("db_user")
    public void setDbUser(String dbUser) {
        this.dbUser = dbUser;
    }

    /** 是否为密钥占位符（GET 恒回 ******；保存时表示保留原值）。 */
    public boolean isSecretPlaceholder() {
        return secretRef == null || "******".equals(secretRef.trim());
    }
}
