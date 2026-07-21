package com.mis.auth.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * mis-auth 业务配置（与 {@code sys_config} 中 security.* 语义对齐，Phase 1 以 yml 为准）。
 */
@ConfigurationProperties(prefix = "mis.auth")
public class AuthProperties {

    private boolean captchaEnabled = true;
    private int maxLoginFailures = 5;
    private long loginLockSeconds = 1800;

    /** 验证码 Redis TTL（秒），对应 {@code security.captcha.ttl} 规划 */
    private long captchaTtlSeconds = 300;
    private int captchaLength = 4;
    private String captchaChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    /** Refresh 落库 {@code client_id} 默认值 */
    private String defaultClientId = "web";
    /** Refresh Cookie 名前缀，全名为 {@code {prefix}{appCode}} */
    private String refreshCookiePrefix = "mis_refresh_";

    private final Cookie cookie = new Cookie();

    /** 是否异步写入 mis-audit 登录日志 */
    private boolean auditEnabled = true;
    /** 是否经 Nacos + LoadBalancer 调用 mis-audit（integration 为 true） */
    private boolean auditDiscoveryEnabled = false;
    /** Nacos 服务名，配合 {@link #auditDiscoveryEnabled} */
    private String auditServiceId = "mis-audit";
    private String auditBaseUrl = "http://localhost:8106";

    /** 是否经 Nacos + LoadBalancer 调用 mis-iam */
    private boolean iamDiscoveryEnabled = false;
    private String iamServiceId = "mis-iam";
    private String iamBaseUrl = "http://localhost:8102";

    public boolean isCaptchaEnabled() {
        return captchaEnabled;
    }

    public void setCaptchaEnabled(boolean captchaEnabled) {
        this.captchaEnabled = captchaEnabled;
    }

    public int getMaxLoginFailures() {
        return maxLoginFailures;
    }

    public void setMaxLoginFailures(int maxLoginFailures) {
        this.maxLoginFailures = maxLoginFailures;
    }

    public long getLoginLockSeconds() {
        return loginLockSeconds;
    }

    public void setLoginLockSeconds(long loginLockSeconds) {
        this.loginLockSeconds = loginLockSeconds;
    }

    public long getCaptchaTtlSeconds() {
        return captchaTtlSeconds;
    }

    public void setCaptchaTtlSeconds(long captchaTtlSeconds) {
        this.captchaTtlSeconds = captchaTtlSeconds;
    }

    public int getCaptchaLength() {
        return captchaLength;
    }

    public void setCaptchaLength(int captchaLength) {
        this.captchaLength = captchaLength;
    }

    public String getCaptchaChars() {
        return captchaChars;
    }

    public void setCaptchaChars(String captchaChars) {
        this.captchaChars = captchaChars;
    }

    public String getDefaultClientId() {
        return defaultClientId;
    }

    public void setDefaultClientId(String defaultClientId) {
        this.defaultClientId = defaultClientId;
    }

    public String getRefreshCookiePrefix() {
        return refreshCookiePrefix;
    }

    public void setRefreshCookiePrefix(String refreshCookiePrefix) {
        this.refreshCookiePrefix = refreshCookiePrefix;
    }

    public Cookie getCookie() {
        return cookie;
    }

    public boolean isAuditEnabled() {
        return auditEnabled;
    }

    public void setAuditEnabled(boolean auditEnabled) {
        this.auditEnabled = auditEnabled;
    }

    public String getAuditBaseUrl() {
        return auditBaseUrl;
    }

    public void setAuditBaseUrl(String auditBaseUrl) {
        this.auditBaseUrl = auditBaseUrl;
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

    public static class Cookie {

        private String path = "/";
        private String sameSite = "Strict";
        private boolean secure = false;

        public String getPath() {
            return path;
        }

        public void setPath(String path) {
            this.path = path;
        }

        public String getSameSite() {
            return sameSite;
        }

        public void setSameSite(String sameSite) {
            this.sameSite = sameSite;
        }

        public boolean isSecure() {
            return secure;
        }

        public void setSecure(boolean secure) {
            this.secure = secure;
        }
    }
}
