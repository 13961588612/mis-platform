package com.mis.adminbff.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * bip-bank-receipt 下游专用配置（基址与超时）。
 *
 * <p>SMP 令牌兑换见 {@link SmpProperties} / {@code SmpTokenExchangeService}。
 */
@ConfigurationProperties(prefix = "mis.bff.bank-receipt")
public class BankReceiptProperties {

    /** bip-bank-receipt 基址（内网，含 context-path）。 */
    private String baseUrl = "http://127.0.0.1:11119/bip-bank-receipt";

    private long connectTimeoutMs = 3000;
    private long readTimeoutMs = 60000;

    /**
     * 兑换时传给老 auth 的 audience；空则用 {@link SmpProperties.TokenExchange#getAudience()}。
     */
    private String audience = "bip-bank-receipt";

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    public long getConnectTimeoutMs() {
        return connectTimeoutMs;
    }

    public void setConnectTimeoutMs(long connectTimeoutMs) {
        this.connectTimeoutMs = connectTimeoutMs;
    }

    public long getReadTimeoutMs() {
        return readTimeoutMs;
    }

    public void setReadTimeoutMs(long readTimeoutMs) {
        this.readTimeoutMs = readTimeoutMs;
    }

    public String getAudience() {
        return audience;
    }

    public void setAudience(String audience) {
        this.audience = audience;
    }
}
