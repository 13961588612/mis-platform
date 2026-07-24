package com.mis.adminbff.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * AI 平台（ai-platform Agent Core）适配层配置。
 *
 * <p>BFF 通过本配置调用 ai-platform 的
 * {@code /api/v1/agents/{agent_id}/chat} 等受 MIS RS256 保护的端点。
 * 详见设计文档 §2.1 / §2.5。
 */
@ConfigurationProperties(prefix = "mis.ai-platform")
public class AiPlatformProperties {

    /** AI 平台 Agent Core 基址，如 http://ai-platform-agent-core:8000 或本地 http://localhost:8000。 */
    private String baseUrl = "http://localhost:8000";

    /** 单次 chat 调用超时（毫秒）。 */
    private long chatTimeoutMs = 60000;

    /** 适配层总开关：关闭后所有 /api/v1/ai/* 能力直接返回不可用。 */
    private boolean enabled = true;

    /** 是否启用 SSE 流式直连（chat/completions）。未启用时回退为非流式缓冲。 */
    private boolean sseEnabled = false;

    /** 表单低置信强制确认阈值（T-ext，Q1）。默认 0.85，可配；BFF 仅下发，不判定。 */
    private double formFillConfThreshold = 0.85;

    /** 健康探测定时刷新间隔（毫秒）。 */
    private long healthCheckIntervalMs = 15000;

    /** 各 capability 是否启用（供 /features 端点与降级门禁使用）。 */
    private CapabilityFeatures features = new CapabilityFeatures();

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    public long getChatTimeoutMs() {
        return chatTimeoutMs;
    }

    public void setChatTimeoutMs(long chatTimeoutMs) {
        this.chatTimeoutMs = chatTimeoutMs;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public boolean isSseEnabled() {
        return sseEnabled;
    }

    public void setSseEnabled(boolean sseEnabled) {
        this.sseEnabled = sseEnabled;
    }

    public double getFormFillConfThreshold() {
        return formFillConfThreshold;
    }

    public void setFormFillConfThreshold(double formFillConfThreshold) {
        this.formFillConfThreshold = formFillConfThreshold;
    }

    public long getHealthCheckIntervalMs() {
        return healthCheckIntervalMs;
    }

    public void setHealthCheckIntervalMs(long healthCheckIntervalMs) {
        this.healthCheckIntervalMs = healthCheckIntervalMs;
    }

    public CapabilityFeatures getFeatures() {
        return features;
    }

    public void setFeatures(CapabilityFeatures features) {
        this.features = features;
    }

    /** 各业务能力的启用开关。 */
    public static class CapabilityFeatures {
        private boolean chat = true;
        private boolean summary = true;
        private boolean extract = true;
        private boolean rag = true;
        private boolean nl2sql = false;

        public boolean isChat() {
            return chat;
        }

        public void setChat(boolean chat) {
            this.chat = chat;
        }

        public boolean isSummary() {
            return summary;
        }

        public void setSummary(boolean summary) {
            this.summary = summary;
        }

        public boolean isExtract() {
            return extract;
        }

        public void setExtract(boolean extract) {
            this.extract = extract;
        }

        public boolean isRag() {
            return rag;
        }

        public void setRag(boolean rag) {
            this.rag = rag;
        }

        public boolean isNl2sql() {
            return nl2sql;
        }

        public void setNl2sql(boolean nl2sql) {
            this.nl2sql = nl2sql;
        }
    }
}
