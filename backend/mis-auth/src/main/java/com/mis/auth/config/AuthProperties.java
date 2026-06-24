package com.mis.auth.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "mis.auth")
public class AuthProperties {

    private boolean captchaEnabled = true;
    private int maxLoginFailures = 5;
    private long loginLockSeconds = 1800;

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
}
