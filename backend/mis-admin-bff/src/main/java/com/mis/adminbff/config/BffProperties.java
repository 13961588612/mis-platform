package com.mis.adminbff.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "mis.bff")
public class BffProperties {

    private boolean iamDiscoveryEnabled = false;
    private String iamServiceId = "mis-iam";
    private String iamBaseUrl = "http://localhost:8102";

    private boolean orgDiscoveryEnabled = false;
    private String orgServiceId = "mis-org";
    private String orgBaseUrl = "http://localhost:8103";

    private boolean systemDiscoveryEnabled = false;
    private String systemServiceId = "mis-system";
    private String systemBaseUrl = "http://localhost:8105";

    private boolean auditDiscoveryEnabled = false;
    private String auditServiceId = "mis-audit";
    private String auditBaseUrl = "http://localhost:8106";

    private boolean authDiscoveryEnabled = false;
    private String authServiceId = "mis-auth";
    private String authBaseUrl = "http://localhost:8101";

    private long aggregateTimeoutMs = 3000;
    private String defaultPassword = "Mis@123456";

    public boolean isIamDiscoveryEnabled() {
        return iamDiscoveryEnabled;
    }

    public void setIamDiscoveryEnabled(boolean iamDiscoveryEnabled) {
        this.iamDiscoveryEnabled = iamDiscoveryEnabled;
    }

    public String getIamServiceId() {
        return iamServiceId;
    }

    public void setIamServiceId(String iamServiceId) {
        this.iamServiceId = iamServiceId;
    }

    public String getIamBaseUrl() {
        return iamBaseUrl;
    }

    public void setIamBaseUrl(String iamBaseUrl) {
        this.iamBaseUrl = iamBaseUrl;
    }

    public boolean isOrgDiscoveryEnabled() {
        return orgDiscoveryEnabled;
    }

    public void setOrgDiscoveryEnabled(boolean orgDiscoveryEnabled) {
        this.orgDiscoveryEnabled = orgDiscoveryEnabled;
    }

    public String getOrgServiceId() {
        return orgServiceId;
    }

    public void setOrgServiceId(String orgServiceId) {
        this.orgServiceId = orgServiceId;
    }

    public String getOrgBaseUrl() {
        return orgBaseUrl;
    }

    public void setOrgBaseUrl(String orgBaseUrl) {
        this.orgBaseUrl = orgBaseUrl;
    }

    public boolean isSystemDiscoveryEnabled() {
        return systemDiscoveryEnabled;
    }

    public void setSystemDiscoveryEnabled(boolean systemDiscoveryEnabled) {
        this.systemDiscoveryEnabled = systemDiscoveryEnabled;
    }

    public String getSystemServiceId() {
        return systemServiceId;
    }

    public void setSystemServiceId(String systemServiceId) {
        this.systemServiceId = systemServiceId;
    }

    public String getSystemBaseUrl() {
        return systemBaseUrl;
    }

    public void setSystemBaseUrl(String systemBaseUrl) {
        this.systemBaseUrl = systemBaseUrl;
    }

    public boolean isAuditDiscoveryEnabled() {
        return auditDiscoveryEnabled;
    }

    public void setAuditDiscoveryEnabled(boolean auditDiscoveryEnabled) {
        this.auditDiscoveryEnabled = auditDiscoveryEnabled;
    }

    public String getAuditServiceId() {
        return auditServiceId;
    }

    public void setAuditServiceId(String auditServiceId) {
        this.auditServiceId = auditServiceId;
    }

    public String getAuditBaseUrl() {
        return auditBaseUrl;
    }

    public void setAuditBaseUrl(String auditBaseUrl) {
        this.auditBaseUrl = auditBaseUrl;
    }

    public boolean isAuthDiscoveryEnabled() {
        return authDiscoveryEnabled;
    }

    public void setAuthDiscoveryEnabled(boolean authDiscoveryEnabled) {
        this.authDiscoveryEnabled = authDiscoveryEnabled;
    }

    public String getAuthServiceId() {
        return authServiceId;
    }

    public void setAuthServiceId(String authServiceId) {
        this.authServiceId = authServiceId;
    }

    public String getAuthBaseUrl() {
        return authBaseUrl;
    }

    public void setAuthBaseUrl(String authBaseUrl) {
        this.authBaseUrl = authBaseUrl;
    }

    public long getAggregateTimeoutMs() {
        return aggregateTimeoutMs;
    }

    public void setAggregateTimeoutMs(long aggregateTimeoutMs) {
        this.aggregateTimeoutMs = aggregateTimeoutMs;
    }

    public String getDefaultPassword() {
        return defaultPassword;
    }

    public void setDefaultPassword(String defaultPassword) {
        this.defaultPassword = defaultPassword;
    }
}
