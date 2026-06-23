package com.mis.common.core.constant;

/**
 * 安全相关常量。
 */
public final class SecurityConstants {

    public static final String AUTHORIZATION_HEADER = "Authorization";
    public static final String BEARER_PREFIX = "Bearer ";
    public static final String REFRESH_TOKEN_COOKIE = "mis_refresh_token";

    public static final String HEADER_USER_ID = "X-User-Id";
    public static final String HEADER_TENANT_ID = "X-Tenant-Id";
    public static final String HEADER_APP_ID = "X-App-Id";
    public static final String HEADER_TRACE_ID = "X-Trace-Id";

    private SecurityConstants() {
    }
}
