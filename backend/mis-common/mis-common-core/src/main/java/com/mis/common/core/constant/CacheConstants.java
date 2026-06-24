package com.mis.common.core.constant;

/**
 * Redis Key 命名规范（ADR-006 / ADR-009 / ADR-011）。
 * <p>
 * <b>约定</b>：
 * <ul>
 *   <li>统一前缀 {@code mis:}，按域分段：{@code auth}、{@code rbac} 等</li>
 *   <li>占位符使用 {@link String#formatted(Object...)} 填充，禁止在业务代码中拼接裸字符串</li>
 *   <li>值类型默认 {@code String}；权限集合等由 mis-rbac 约定序列化格式（如 JSON Set）</li>
 *   <li>TTL 以各 Service 写入时为准；权限类以<strong>主动 DEL/INCR</strong>为主，TTL 仅兜底</li>
 * </ul>
 * <p>
 * <b>使用示例</b>：
 * <pre>{@code
 * // 登录失败计数
 * String failKey = CacheConstants.AUTH_LOGIN_FAIL.formatted(tenantId, appId, username);
 * redisTemplate.opsForValue().increment(failKey);
 *
 * // 验证码（验证后 delete）
 * String captchaKey = CacheConstants.AUTH_CAPTCHA.formatted(captchaId);
 * redisTemplate.opsForValue().set(captchaKey, code, Duration.ofSeconds(300));
 *
 * // Access Token 黑名单（登出写入，Gateway 读取）
 * String blacklistKey = CacheConstants.AUTH_TOKEN_BLACKLIST.formatted(jti);
 * redisTemplate.opsForValue().set(blacklistKey, "1", accessRemainingTtl);
 *
 * // Refresh Token 快查（值为 "userId:appId"）
 * String refreshKey = CacheConstants.AUTH_REFRESH.formatted(tokenSha256Hex);
 * redisTemplate.opsForValue().set(refreshKey, userId + ":" + appId, refreshTtl);
 *
 * // 权限版本（角色变更时 INCR；登录响应带给前端）
 * String versionKey = CacheConstants.RBAC_PERM_VERSION.formatted(tenantId, appId, userId);
 * Long version = redisTemplate.opsForValue().increment(versionKey);
 *
 * // 用户权限集合（BFF 鉴权、/auth/me；角色变更时 DEL）
 * String permKey = CacheConstants.RBAC_PERMISSIONS.formatted(tenantId, appId, userId);
 * redisTemplate.opsForValue().set(permKey, permissionJson, Duration.ofMinutes(15));
 * }</pre>
 *
 * @see com.mis.common.redis.auth.TokenBlacklistService
 * @see com.mis.auth.service.LoginLockService
 * @see com.mis.auth.service.CaptchaService
 * @see com.mis.auth.service.RefreshTokenService
 */
public final class CacheConstants {

    /**
     * 用户在某租户、某 APP 下的权限集合缓存。
     * <p>
     * Key：{@code mis:rbac:permissions:{tenantId}:{appId}:{userId}}<br>
     * 值：permission 字符串集合（如 JSON），由 mis-rbac 写入<br>
     * TTL：约 15min（兜底）；角色/菜单/用户角色变更时<strong>主动 DEL</strong><br>
     * 读取：mis-admin-bff 鉴权、{@code GET /auth/me}
     */
    public static final String RBAC_PERMISSIONS = "mis:rbac:permissions:%d:%d:%d";

    /**
     * 用户权限版本号（前端对比 JWT / 本地缓存是否过期）。
     * <p>
     * Key：{@code mis:rbac:perm-version:{tenantId}:{appId}:{userId}}<br>
     * 值：递增 long 字符串<br>
     * 写入：mis-rbac 权限变更时 INCR；登录时 {@link com.mis.auth.service.AuthService} 读取<br>
     * TTL：通常不设或长期保留
     */
    public static final String RBAC_PERM_VERSION = "mis:rbac:perm-version:%d:%d:%d";

    /**
     * 登录失败次数（达阈值锁定账号）。
     * <p>
     * Key：{@code mis:auth:login-fail:{tenantId}:{appId}:{username}}<br>
     * 值：失败次数（字符串整数）<br>
     * TTL：首次失败时设置（默认 30min，见 {@code AuthProperties.loginLockSeconds}）<br>
     * 写入/读：{@link com.mis.auth.service.LoginLockService}
     */
    public static final String AUTH_LOGIN_FAIL = "mis:auth:login-fail:%d:%d:%s";

    /**
     * Refresh Token 快查索引（PostgreSQL {@code sys_refresh_token} 的 Redis 加速层）。
     * <p>
     * Key：{@code mis:auth:refresh:{tokenHash}}（SHA-256 hex，非明文 token）<br>
     * 值：{@code "{userId}:{appId}"}<br>
     * TTL：与 Refresh 有效期一致（默认 7d）<br>
     * 写入/删：{@link com.mis.auth.service.RefreshTokenService}
     */
    public static final String AUTH_REFRESH = "mis:auth:refresh:%s";

    /**
     * 图形验证码。
     * <p>
     * Key：{@code mis:auth:captcha:{captchaId}}（UUID）<br>
     * 值：验证码明文（小写）<br>
     * TTL：300s；校验后立即 delete（一次性）<br>
     * 写入/读：{@link com.mis.auth.service.CaptchaService}
     */
    public static final String AUTH_CAPTCHA = "mis:auth:captcha:%s";

    /**
     * Access Token {@code jti} 黑名单（登出吊销）。
     * <p>
     * Key：{@code mis:auth:token:blacklist:{jti}}<br>
     * 值：占位 {@code "1"}<br>
     * TTL：Access Token 剩余有效期（过期自动清理）<br>
     * 写：mis-auth 登出；读：mis-gateway {@link com.mis.common.redis.auth.TokenBlacklistService}
     */
    public static final String AUTH_TOKEN_BLACKLIST = "mis:auth:token:blacklist:%s";

    private CacheConstants() {
    }
}
