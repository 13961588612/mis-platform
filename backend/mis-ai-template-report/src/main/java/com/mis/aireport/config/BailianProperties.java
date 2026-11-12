package com.mis.aireport.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 阿里百炼（DashScope 应用 completion）平台级配置。API Key 只来自环境变量 / Nacos，不进报表。
 */
@ConfigurationProperties(prefix = "mis.ai-report.bailian")
public class BailianProperties {

    private String apiKey = "";

    private String baseUrl = "https://dashscope.aliyuncs.com";

    /** 可选，对应 Header X-DashScope-WorkSpace。 */
    private String workspace = "";

    private int timeoutSeconds = 90;

    public String getApiKey() {
        return apiKey;
    }

    public void setApiKey(String apiKey) {
        this.apiKey = apiKey;
    }

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    public String getWorkspace() {
        return workspace;
    }

    public void setWorkspace(String workspace) {
        this.workspace = workspace;
    }

    public int getTimeoutSeconds() {
        return timeoutSeconds;
    }

    public void setTimeoutSeconds(int timeoutSeconds) {
        this.timeoutSeconds = timeoutSeconds;
    }
}
