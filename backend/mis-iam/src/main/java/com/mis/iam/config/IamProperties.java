package com.mis.iam.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "mis.iam")
public class IamProperties {

    /** 创建用户时是否校验 mis-org 员工存在 */
    private boolean orgCheckEnabled = true;
    /** 是否经 Nacos LoadBalancer 调用 mis-org */
    private boolean orgDiscoveryEnabled = false;
    private String orgServiceId = "mis-org";
    private String orgBaseUrl = "http://localhost:8103";
    /** 重置密码未传新密码时的默认值（对齐 sys_config.user.default_password） */
    private String defaultPassword = "Mis@123456";

    private boolean systemDiscoveryEnabled = false;
    private String systemServiceId = "mis-system";
    private String systemBaseUrl = "http://localhost:8105";
    /** permissions Redis TTL（分钟） */
    private long permissionsTtlMinutes = 15;

    public boolean isOrgCheckEnabled() {
        return orgCheckEnabled;
    }

    public void setOrgCheckEnabled(boolean orgCheckEnabled) {
        this.orgCheckEnabled = orgCheckEnabled;
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

    public String getDefaultPassword() {
        return defaultPassword;
    }

    public void setDefaultPassword(String defaultPassword) {
        this.defaultPassword = defaultPassword;
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

    public long getPermissionsTtlMinutes() {
        return permissionsTtlMinutes;
    }

    public void setPermissionsTtlMinutes(long permissionsTtlMinutes) {
        this.permissionsTtlMinutes = permissionsTtlMinutes;
    }
}
