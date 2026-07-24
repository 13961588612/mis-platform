package com.mis.org.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "mis.org")
public class OrgProperties {

    private boolean iamDiscoveryEnabled = false;
    private String iamServiceId = "mis-iam";
    private String iamBaseUrl = "http://localhost:8102";
    /** 无登录上下文时是否跳过 DataScope（内部调用） */
    private boolean dataScopeSkipWhenAnonymous = true;

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

    public boolean isDataScopeSkipWhenAnonymous() {
        return dataScopeSkipWhenAnonymous;
    }

    public void setDataScopeSkipWhenAnonymous(boolean dataScopeSkipWhenAnonymous) {
        this.dataScopeSkipWhenAnonymous = dataScopeSkipWhenAnonymous;
    }
}
