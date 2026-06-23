package com.mis.common.core.constant;

/**
 * Redis Key 前缀（ADR-009 / ADR-011）。
 */
public final class CacheConstants {

    public static final String RBAC_PERMISSIONS = "mis:rbac:permissions:%d:%d:%d";
    public static final String RBAC_PERM_VERSION = "mis:rbac:perm-version:%d:%d:%d";
    public static final String AUTH_LOGIN_FAIL = "mis:auth:login-fail:%d:%d:%s";
    public static final String AUTH_REFRESH = "mis:auth:refresh:%s";
    public static final String AUTH_CAPTCHA = "mis:auth:captcha:%s";
    public static final String AUTH_TOKEN_BLACKLIST = "mis:auth:token:blacklist:%s";

    private CacheConstants() {
    }
}
