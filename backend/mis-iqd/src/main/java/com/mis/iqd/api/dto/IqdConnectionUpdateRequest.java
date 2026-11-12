package com.mis.iqd.api.dto;

/**
 * 连接配置**局部更新**请求（{@code PUT /api/v1/iqd/connections/{id}}，v1.11 T06 / system-design §14.1）。
 *
 * <h2>为什么必须独立于 {@link IqdConnectionSaveRequest}（关键裁决）</h2>
 * {@code IqdConnectionSaveRequest} 带 Java 字段默认值（{@code authType="none"} /
 * {@code timeoutSeconds=60} / {@code language="zh-CN"} / {@code enabled=true}）。若复用它做局部更新，
 * <b>未提交的字段会被这些默认值静默覆盖</b> —— 例如「只改个名」会顺带把 {@code timeout_seconds}
 * 重置为 60、把 {@code auth_type} 重置为 {@code none}、把 {@code language} 重置为 {@code zh-CN}。
 * 这在「按 id 精确更新一条既有连接」的语义下是**静默数据损坏**，故本端点**必须**用独立 DTO。
 *
 * <h2>字段默认值 = 全部 {@code null}（局部更新语义）</h2>
 * 本 DTO 字段<b>全 {@code null} 默认、无 {@code @NotBlank}/{@code @NotNull}</b>。
 * 控制器按 wire 的 {@code containsKey} 填充（仅显式提交的键才非 {@code null}），
 * 服务层统一按 {@code null = 保留原值} 处理（见 {@code IqdAdminService#applyConnectionFields}）。
 *
 * <table border="1">
 *   <caption>字段语义（§14.1）</caption>
 *   <tr><th>字段</th><th>缺省 / {@code null}</th><th>提交值</th><th>备注</th></tr>
 *   <tr><td>{@code name}</td><td>保留原名</td><td>改名（唯一校验 → 40900）</td><td>空串视为缺省</td></tr>
 *   <tr><td>{@code base_url} / {@code project_id} / {@code default_connector}</td>
 *       <td>保留原值</td><td>覆盖</td><td>—</td></tr>
 *   <tr><td>{@code auth_type}</td><td>保留原值</td><td>覆盖</td><td>空串视为缺省</td></tr>
 *   <tr><td>{@code timeout_seconds}</td><td>保留原值</td><td>覆盖</td><td>须 &gt; 0，否则 42200</td></tr>
 *   <tr><td>{@code language}</td><td>保留原值</td><td>覆盖</td><td>空白视为缺省</td></tr>
 *   <tr><td>{@code secret_ref}</td><td>保留原值</td><td>覆盖</td>
 *       <td>与 create 逐字一致：{@code null} / 占位符 {@code ******} / 空白 → 不改</td></tr>
 *   <tr><td>{@code enabled}</td><td>保留原值</td><td>覆盖</td>
 *       <td><b>只改本行，不联动其它连接</b>（多条可并存，§14.5）</td></tr>
 * </table>
 *
 * <p>⚠️ <b>不提供「清空字段」</b>（§14.1）：wire 上无法区分「未提交」与「显式置空」，
 * 引入哨兵值会让契约变脆。若业务确需把 {@code base_url} 置空，另开「显式 null 语义」讨论。
 *
 * <p>⚠️ <b>不含 {@code mdl_writeback_enabled}</b>（§14.10 第 4 项）：该字段归
 * {@code PUT /config} / config 页，本端点不纳入（避免双重写）。
 */
public class IqdConnectionUpdateRequest {

    /** 改名目标（缺省/空白 = 保留原名；非空且与原值不同才触发唯一校验）。 */
    private String name;

    /** WrenAI 服务地址。 */
    private String baseUrl;

    /** 认证方式：{@code none} | {@code basic} | {@code token}（空串视为缺省）。 */
    private String authType;

    /** 密钥引用；提交非空且非占位符才更新（{@code ******} / 空白 = 保留原值）。 */
    private String secretRef;

    /** WrenAI 项目 id。 */
    private String projectId;

    /** 默认连接器（如 postgres）。 */
    private String defaultConnector;

    /** 超时秒数（须 &gt; 0，否则 42200）。 */
    private Integer timeoutSeconds;

    /** 语言（如 zh-CN）。 */
    private String language;

    /** 连接可用性开关（可多条同时 true；只改本行，不联动其它）。 */
    private Boolean enabled;

    /** 【分层 2026-09-29】所属数据库连接配置（null = 保留原值）。 */
    private Long profileId;

    // ---- 路线 A：业务库连接展示字段（null = 保留原值；密码不在本 DTO）----
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

    public Long getProfileId() {
        return profileId;
    }

    public void setProfileId(Long profileId) {
        this.profileId = profileId;
    }

    /**
     * 是否为密钥占位符（{@code ******} 或 {@code null}）—— 表示保留原值。
     *
     * <p>与 {@link IqdConnectionSaveRequest#isSecretPlaceholder()} 逐字一致（同一占位符口径）。
     */
    public boolean isSecretPlaceholder() {
        return secretRef == null || "******".equals(secretRef.trim());
    }
}
