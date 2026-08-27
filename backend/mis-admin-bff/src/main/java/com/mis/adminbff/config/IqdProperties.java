package com.mis.adminbff.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 问数（IQD）适配层配置。
 *
 * <p>BFF 通过本配置调用 mis-iqd 的管理面（{@code /api/v1/iqd/**}）与
 * 内部面（{@code /internal/v1/iqd/**}）端点，并把问数 SSE 请求转发给
 * ai-platform 的 mis-iqd Agent（Worker 侧编排链）。
 *
 * <p><b>登记方式</b>：{@code @ConfigurationProperties} 只是「可绑定」声明，
 * 必须在 {@link BffConfiguration#BffConfiguration()} 的
 * {@code @EnableConfigurationProperties} 中登记才会实例化 Bean（与
 * {@link AiPlatformProperties} / {@link BffProperties} 同口径）。
 */
@ConfigurationProperties(prefix = "mis.iqd")
public class IqdProperties {

    /** mis-iqd 服务基址（本地默认 127.0.0.1；Docker/Nacos 用服务名覆盖）。 */
    private String baseUrl = "http://127.0.0.1:8109";

    /** 管理面/内部面单次调用超时（毫秒）。 */
    private long timeoutMs = 5000;

    /** 问数 SSE 流式总开关：关闭后 ask-stream 回退为非流式缓冲。 */
    private boolean sseEnabled = true;

    /** 问数单次请求超时（毫秒；包含 Worker 完整编排链，默认放宽到 180s）。 */
    private long askTimeoutMs = 180000;

    /** admin 视图权限码：持有者 ask 时 view=admin（含 SQL），否则 view=user（剥 SQL 键）。 */
    private String adminViewPermission = "iqd:trace:view";

    /** 管理面代理功能权限码（GET/PUT /config、POST /config/test）。 */
    private String configViewPermission = "iqd:config:view";
    private String configSavePermission = "iqd:config:save";
    private String configTestPermission = "iqd:config:test";

    /** 问数功能权限码（ask / ask-stream 双闸门之一，无则 40300）。 */
    private String askPermission = "ai:chat:use";

    /** W2 管理面功能权限码（清单/范围/ACL/脱敏/维度）。 */
    private String catalogPermission = "iqd:catalog:view";
    private String scopeViewPermission = "iqd:scope:view";
    private String scopeSavePermission = "iqd:scope:save";
    private String aclViewPermission = "iqd:acl:view";
    private String aclSavePermission = "iqd:acl:save";
    private String maskViewPermission = "iqd:mask:view";
    private String maskSavePermission = "iqd:mask:save";
    private String dimensionViewPermission = "iqd:dimension:view";
    private String dimensionSavePermission = "iqd:dimension:save";
    private String syncPermission = "iqd:scope:sync";

    /** W3 审计回查功能权限码（/traces、/traces/{id}）。 */
    private String traceViewPermission = "iqd:trace:view";

    /** W4 增强物料功能权限码（sql-pairs / knowledge / enhance push）。 */
    private String enhanceViewPermission = "iqd:enhance:view";
    private String enhanceSavePermission = "iqd:enhance:save";
    private String enhanceSyncPermission = "iqd:enhance:sync";

    /** 二期 catalog 编辑（写回 MDL）功能权限码（PUT /catalog/node 等）。 */
    private String catalogEditPermission = "iqd:catalog:edit";

    /** Worker 侧 mis-iqd Agent 的 agentId（ai-platform Agent Core 注册名）。 */
    private String agentId = "mis-iqd";

    /**
     * 增强同步触发端点（BFF → ai-platform，默认 /api/v1/iqd/enhance/sync）。
     * wait=false 接受即返回；wait=true 阻塞至 build+index 完成。
     */
    private String enhanceSyncEndpoint = "/api/v1/iqd/enhance/sync";

    /**
     * 增强同步状态查询端点（BFF → mis-iqd，默认 /api/v1/iqd/enhance/sync-status）。
     * 由 IqdSyncJob 最新作业驱动前端 SyncStatusBar。
     */
    private String enhanceStatusEndpoint = "/api/v1/iqd/enhance/sync-status";

    /**
     * 二类前向：MDL 写回开关（一期恒 false）。开启后平台内改 catalog 才回写 WrenAI；
     * 一期 catalog 读取仍走单向 syncCatalogFromMdl，此开关仅占位。
     */
    private boolean mdlWritebackEnabled = false;

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    public long getTimeoutMs() {
        return timeoutMs;
    }

    public void setTimeoutMs(long timeoutMs) {
        this.timeoutMs = timeoutMs;
    }

    public boolean isSseEnabled() {
        return sseEnabled;
    }

    public void setSseEnabled(boolean sseEnabled) {
        this.sseEnabled = sseEnabled;
    }

    public long getAskTimeoutMs() {
        return askTimeoutMs;
    }

    public void setAskTimeoutMs(long askTimeoutMs) {
        this.askTimeoutMs = askTimeoutMs;
    }

    public String getAdminViewPermission() {
        return adminViewPermission;
    }

    public void setAdminViewPermission(String adminViewPermission) {
        this.adminViewPermission = adminViewPermission;
    }

    public String getConfigViewPermission() {
        return configViewPermission;
    }

    public void setConfigViewPermission(String configViewPermission) {
        this.configViewPermission = configViewPermission;
    }

    public String getConfigSavePermission() {
        return configSavePermission;
    }

    public void setConfigSavePermission(String configSavePermission) {
        this.configSavePermission = configSavePermission;
    }

    public String getConfigTestPermission() {
        return configTestPermission;
    }

    public void setConfigTestPermission(String configTestPermission) {
        this.configTestPermission = configTestPermission;
    }

    public String getAskPermission() {
        return askPermission;
    }

    public void setAskPermission(String askPermission) {
        this.askPermission = askPermission;
    }

    public String getCatalogPermission() {
        return catalogPermission;
    }

    public void setCatalogPermission(String catalogPermission) {
        this.catalogPermission = catalogPermission;
    }

    public String getScopeViewPermission() {
        return scopeViewPermission;
    }

    public void setScopeViewPermission(String scopeViewPermission) {
        this.scopeViewPermission = scopeViewPermission;
    }

    public String getScopeSavePermission() {
        return scopeSavePermission;
    }

    public void setScopeSavePermission(String scopeSavePermission) {
        this.scopeSavePermission = scopeSavePermission;
    }

    public String getAclViewPermission() {
        return aclViewPermission;
    }

    public void setAclViewPermission(String aclViewPermission) {
        this.aclViewPermission = aclViewPermission;
    }

    public String getAclSavePermission() {
        return aclSavePermission;
    }

    public void setAclSavePermission(String aclSavePermission) {
        this.aclSavePermission = aclSavePermission;
    }

    public String getMaskViewPermission() {
        return maskViewPermission;
    }

    public void setMaskViewPermission(String maskViewPermission) {
        this.maskViewPermission = maskViewPermission;
    }

    public String getMaskSavePermission() {
        return maskSavePermission;
    }

    public void setMaskSavePermission(String maskSavePermission) {
        this.maskSavePermission = maskSavePermission;
    }

    public String getDimensionViewPermission() {
        return dimensionViewPermission;
    }

    public void setDimensionViewPermission(String dimensionViewPermission) {
        this.dimensionViewPermission = dimensionViewPermission;
    }

    public String getDimensionSavePermission() {
        return dimensionSavePermission;
    }

    public void setDimensionSavePermission(String dimensionSavePermission) {
        this.dimensionSavePermission = dimensionSavePermission;
    }

    public String getSyncPermission() {
        return syncPermission;
    }

    public void setSyncPermission(String syncPermission) {
        this.syncPermission = syncPermission;
    }

    public String getTraceViewPermission() {
        return traceViewPermission;
    }

    public void setTraceViewPermission(String traceViewPermission) {
        this.traceViewPermission = traceViewPermission;
    }

    public String getEnhanceViewPermission() {
        return enhanceViewPermission;
    }

    public void setEnhanceViewPermission(String enhanceViewPermission) {
        this.enhanceViewPermission = enhanceViewPermission;
    }

    public String getEnhanceSavePermission() {
        return enhanceSavePermission;
    }

    public void setEnhanceSavePermission(String enhanceSavePermission) {
        this.enhanceSavePermission = enhanceSavePermission;
    }

    public String getEnhanceSyncPermission() {
        return enhanceSyncPermission;
    }

    public void setEnhanceSyncPermission(String enhanceSyncPermission) {
        this.enhanceSyncPermission = enhanceSyncPermission;
    }

    public String getCatalogEditPermission() {
        return catalogEditPermission;
    }

    public void setCatalogEditPermission(String catalogEditPermission) {
        this.catalogEditPermission = catalogEditPermission;
    }

    public String getAgentId() {
        return agentId;
    }

    public void setAgentId(String agentId) {
        this.agentId = agentId;
    }

    public String getEnhanceSyncEndpoint() {
        return enhanceSyncEndpoint;
    }

    public void setEnhanceSyncEndpoint(String enhanceSyncEndpoint) {
        this.enhanceSyncEndpoint = enhanceSyncEndpoint;
    }

    public String getEnhanceStatusEndpoint() {
        return enhanceStatusEndpoint;
    }

    public void setEnhanceStatusEndpoint(String enhanceStatusEndpoint) {
        this.enhanceStatusEndpoint = enhanceStatusEndpoint;
    }

    public boolean isMdlWritebackEnabled() {
        return mdlWritebackEnabled;
    }

    public void setMdlWritebackEnabled(boolean mdlWritebackEnabled) {
        this.mdlWritebackEnabled = mdlWritebackEnabled;
    }
}
