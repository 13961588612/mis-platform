package com.mis.adminbff.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.ArrayList;
import java.util.List;

/** 室内地图（indoor-map Nest）下游。对应 {@code mis.imap.*}。 */
@ConfigurationProperties(prefix = "mis.imap")
public class ImapProperties {

    private String baseUrl = "http://localhost:3000";

    private long timeoutMs = 15000;

    private boolean intranetOnly = true;

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
