package com.mis.adminbff.dto.iqd;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * 连接配置保存请求（BFF 代理 PUT /api/v1/iqd/config）。
 *
 * <p>密钥提交规则：{@code secretRef} 非空才更新；空值/占位符（******）表示保留原值。
 * 与 mis-iqd {@code IqdConnectionSaveRequest} 同构，BFF 只透传。
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

    public Boolean getEnabled() {
        return enabled;
    }

    public void setEnabled(Boolean enabled) {
        this.enabled = enabled;
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
}
