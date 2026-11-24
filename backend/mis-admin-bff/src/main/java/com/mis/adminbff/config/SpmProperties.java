package com.mis.adminbff.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.ArrayList;
import java.util.List;

/**
 * 超市运营（spm-service / mis-spm-biz）下游配置。
 *
 * <p>对应 {@code mis.spm.*}。与老 SMP 鉴权 {@code mis.bff.smp} 不是同一前缀。
 */
@ConfigurationProperties(prefix = "mis.spm")
public class SpmProperties {

    /** spm-service 内网基址。 */
    private String baseUrl = "http://localhost:8112";

    private long timeoutMs = 15000;

    /** 为 true 时仅允许内网客户端访问本应用 API / 门户卡片。 */
    private boolean intranetOnly = true;

    /** 额外放行的 CIDR（办公出口是公网 NAT 时配置）。 */
    private List<String> extraAllowedCidrs = new ArrayList<>();

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

    public boolean isIntranetOnly() {
        return intranetOnly;
    }

    public void setIntranetOnly(boolean intranetOnly) {
        this.intranetOnly = intranetOnly;
    }

    public List<String> getExtraAllowedCidrs() {
        return extraAllowedCidrs;
    }

    public void setExtraAllowedCidrs(List<String> extraAllowedCidrs) {
        this.extraAllowedCidrs = extraAllowedCidrs != null ? extraAllowedCidrs : new ArrayList<>();
    }
}
