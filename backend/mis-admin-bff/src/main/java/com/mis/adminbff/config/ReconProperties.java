package com.mis.adminbff.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 对账平台（recon-service）下游适配配置。
 *
 * <p>对应 {@code mis.recon.*}。本配置只描述 <b>BFF 往哪里发请求</b>：
 * recon-service 只暴露内网 {@code /internal/v1/recon/**}，BFF 将其以
 * {@code /api/v1/recon/**} 原样透传给前端（方案 A：前端统一走 Gateway → BFF →
 * recon-service，不再直连 8110）。
 *
 * <p>与 agent-ops 的差异：recon 是纯透传，BFF 不参与任何字段加工，
 * 故没有「两个基址」问题，只有一个 base-url。
 */
@ConfigurationProperties(prefix = "mis.recon")
public class ReconProperties {

    /** recon-service 内网基址（承载全部 /internal/v1/recon/** 端点）。 */
    private String baseUrl = "http://localhost:8110";

    /** 调用超时（毫秒）。对账引擎的查询/拉取动作为真实 DB/网络操作，3s 会误判超时。 */
    private long timeoutMs = 15000;

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
