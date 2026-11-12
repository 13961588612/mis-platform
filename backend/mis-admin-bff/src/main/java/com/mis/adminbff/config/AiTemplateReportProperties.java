package com.mis.adminbff.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * BFF → mis-ai-template-report 下游配置。
 */
@ConfigurationProperties(prefix = "mis.ai-template-report")
public class AiTemplateReportProperties {

    /** 本地默认 8110；Docker/Nacos 用服务名覆盖。 */
    private String baseUrl = "http://127.0.0.1:8110";

    private long timeoutMs = 5000L;

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
}
