package com.mis.common.core.constant;

/**
 * 安全相关常量：HTTP 头、Cookie 命名。
 * <p>
 * <b>透传头</b>由 Gateway {@code JwtAuthenticationGlobalFilter} 写入，下游通过
 * {@code GatewayContextFilter} + {@code LoginUserHeaderResolver} 解析。
 * <p>
 * 命名与 {@code docs/architecture/03-security.md}、OpenAPI 规范保持一致；
 * BFF 调用领域服务时需继续透传（mis-common-client 待实现）。
 */
public final class SecurityConstants {

    public static final String AUTHORIZATION_HEADER = "Authorization";
    /** Access Token 前缀，后接 JWT 字符串 */
    public static final String BEARER_PREFIX = "Bearer ";
    /** 历史占位；实际 Refresh Cookie 名为 {@code mis_refresh_{appCode}}，见 RefreshTokenService */
    public static final String REFRESH_TOKEN_COOKIE = "mis_refresh_token";

    /** 用户主键，对应 sys_user.id */
    public static final String HEADER_USER_ID = "X-User-Id";
    /** 租户 ID */
    public static final String HEADER_TENANT_ID = "X-Tenant-Id";
    /** 登录所在 APP（ADR-011 多 APP 隔离） */
    public static final String HEADER_APP_ID = "X-App-Id";
    /** 员工主数据 ID */
    public static final String HEADER_EMPLOYEE_ID = "X-Employee-Id";
    public static final String HEADER_USERNAME = "X-Username";
    /** 全链路追踪 ID */
    public static final String HEADER_TRACE_ID = "X-Trace-Id";
    /**
     * BFF 返回：JWT {@code permVersion} 与当前版本不一致时置 {@code true}，前端应拉 {@code GET /auth/me}（ADR-009）。
     */
    public static final String HEADER_PERM_STALE = "X-Perm-Stale";

    private SecurityConstants() {
    }
}
