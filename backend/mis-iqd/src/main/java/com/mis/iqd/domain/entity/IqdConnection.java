package com.mis.iqd.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * 问数连接配置（iqd_connection）。
 *
 * <p>仅存 WrenAI profile 名/连接标识，<b>不存业务库凭证</b>（凭证由 {@code wren profile}
 * server-side 注入，见 deploy-iqd.md）。一期业务上仅一条 {@code enabled=true}。
 */
@Entity
@Table(name = "iqd_connection")
public class IqdConnection {

    @Id
    private Long id;

    @Column(nullable = false)
    private String name;

    @Column(name = "base_url")
    private String baseUrl;

    @Column(name = "auth_type", nullable = false)
    private String authType = "none";

    @Column(name = "secret_ref")
    private String secretRef;

    @Column(name = "project_id")
    private String projectId;

    @Column(name = "default_connector")
    private String defaultConnector;

    @Column(name = "timeout_seconds", nullable = false)
    private Integer timeoutSeconds = 60;

    @Column(nullable = false)
    private String language = "zh-CN";

    @Column(nullable = false)
    private String status = "inactive";

    @Column(name = "last_health_at")
    private Instant lastHealthAt;

    @Column(name = "last_health_msg")
    private String lastHealthMsg;

    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(nullable = false)
    private Integer enabled = 1;

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

    public Integer getEnabled() {
        return enabled;
    }

    public void setEnabled(Integer enabled) {
        this.enabled = enabled;
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
