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

    /** 平台当前编辑版本（单调递增，从 0 起）。每次编辑成功 +1。 */
    @Column(name = "current_edit_revision", nullable = false)
    private Long currentEditRevision = 0L;

    /** 已写回 WrenAI 的版本（build 成功回调推进）。 */
    @Column(name = "built_edit_revision", nullable = false)
    private Long builtEditRevision = 0L;

    /** 按连接灰度闸门：开启后平台内改 catalog 才回写 WrenAI（U7/Q4）。默认 true。 */
    @Column(name = "mdl_writeback_enabled", nullable = false)
    private Boolean mdlWritebackEnabled = true;

    /** 最近一次成功写回的 mdl_hash（WrenAI 部署产物标识）。 */
    @Column(name = "built_mdl_hash")
    private String builtMdlHash;

    /** 【G7】基线完整 MDL（最近一次 WrenAI 同步快照，context build --mdl 输入）。 */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "mdl_raw", columnDefinition = "jsonb")
    private String mdlRaw;

    /** 【S3】外部漂移标记：WrenAI 当前 mdl_hash 与 built_mdl_hash 不一致。 */
    @Column(name = "stale_drift", nullable = false)
    private Boolean staleDrift = false;

    /**
     * 【方案A·多连接】WrenAI MCP 进程状态（running/stopped/starting/crashed/unhealthy）。
     * 由 ai-platform Worker 进程管理器（WrenMcpProcessManager）回写，供可观测（REQ-P1-2）。
     */
    @Column(name = "mcp_status")
    private String mcpStatus;

    /**
     * 【方案A·多连接】WrenAI MCP 进程监听端口。
     * 进程管理器从 {@code wren_mcp_port_range} 按连接分配并回收，回写此列供前端轮询展示。
     */
    @Column(name = "mcp_port")
    private Integer mcpPort;

    /**
     * 【方案A·跨机器落地 v0.2】WrenAI MCP 数据面可达 host（ai-platform 侧视角）。
     * 由 ai-platform Worker 经 WrenMcpAgentClient.ensure 回写（agent 数据面
     * mcp_endpoint），供前端/可观测定位跨机器部署位置。仅存引用，绝不存凭证明文。
     */
    @Column(name = "mcp_host")
    private String mcpHost;

    /**
     * 【方案A·跨机器落地 v0.2】WrenMcpAgent 部署句柄（agent_handle）。
     * 由 ai-platform Worker 经控制通道回写；用于后续 stop/restart/heartbeat 路由定位
     * wren 机上的具体部署。仅存引用，不存凭证（决策 ③ S1：wren 机不接 Vault）。
     */
    @Column(name = "agent_handle")
    private String agentHandle;

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

    public Long getCurrentEditRevision() {
        return currentEditRevision;
    }

    public void setCurrentEditRevision(Long currentEditRevision) {
        this.currentEditRevision = currentEditRevision;
    }

    public Long getBuiltEditRevision() {
        return builtEditRevision;
    }

    public void setBuiltEditRevision(Long builtEditRevision) {
        this.builtEditRevision = builtEditRevision;
    }

    public Boolean getMdlWritebackEnabled() {
        return mdlWritebackEnabled;
    }

    public void setMdlWritebackEnabled(Boolean mdlWritebackEnabled) {
        this.mdlWritebackEnabled = mdlWritebackEnabled;
    }

    public String getBuiltMdlHash() {
        return builtMdlHash;
    }

    public void setBuiltMdlHash(String builtMdlHash) {
        this.builtMdlHash = builtMdlHash;
    }

    public String getMdlRaw() {
        return mdlRaw;
    }

    public void setMdlRaw(String mdlRaw) {
        this.mdlRaw = mdlRaw;
    }

    public Boolean getStaleDrift() {
        return staleDrift;
    }

    public void setStaleDrift(Boolean staleDrift) {
        this.staleDrift = staleDrift;
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

    public String getMcpHost() {
        return mcpHost;
    }

    public void setMcpHost(String mcpHost) {
        this.mcpHost = mcpHost;
    }

    public String getAgentHandle() {
        return agentHandle;
    }

    public void setAgentHandle(String agentHandle) {
        this.agentHandle = agentHandle;
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
