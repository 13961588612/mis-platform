package com.mis.auth.service;

import com.mis.auth.config.AuthProperties;
import com.mis.auth.domain.entity.SysApp;
import com.mis.auth.domain.entity.SysEmployee;
import com.mis.auth.domain.entity.SysUser;
import com.mis.auth.domain.repository.SysAppRepository;
import com.mis.auth.domain.repository.SysEmployeeRepository;
import com.mis.auth.domain.repository.SysRoleRepository;
import com.mis.auth.domain.repository.SysUserRepository;
import com.mis.auth.dto.LoginRequest;
import com.mis.auth.dto.LoginResponse;
import com.mis.auth.dto.TokenResponse;
import com.mis.common.core.constant.CacheConstants;
import com.mis.common.core.constant.SecurityConstants;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.redis.auth.TokenBlacklistService;
import com.mis.common.security.jwt.AccessTokenClaims;
import com.mis.common.security.jwt.IssuedAccessToken;
import com.mis.common.security.jwt.JwtClaims;
import com.mis.common.security.jwt.JwtIssuer;
import com.mis.common.security.jwt.JwtProperties;
import com.mis.common.security.jwt.JwtVerifier;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.util.List;

/**
 * 认证核心业务（L0）：登录、刷新、登出。
 * <p>
 * <b>不做</b> API 权限判断；permissions 由 mis-rbac 写入 Redis，BFF 鉴权时读取（ADR-008/009）。
 * <p>
 * Phase 1 直接 JPA 查 {@code sys_user}；后续可改为调用 mis-user 内部 API。
 *
 * @see com.mis.auth.controller.AuthController
 */
@Service
public class AuthService {

    private final SysAppRepository sysAppRepository;
    private final SysUserRepository sysUserRepository;
    private final SysEmployeeRepository sysEmployeeRepository;
    private final SysRoleRepository sysRoleRepository;
    private final CaptchaService captchaService;
    private final LoginLockService loginLockService;
    private final RefreshTokenService refreshTokenService;
    private final JwtIssuer jwtIssuer;
    private final JwtVerifier jwtVerifier;
    private final JwtProperties jwtProperties;
    private final TokenBlacklistService tokenBlacklistService;
    private final PasswordEncoder passwordEncoder;
    private final AuthProperties authProperties;
    private final StringRedisTemplate redisTemplate;

    public AuthService(
            SysAppRepository sysAppRepository,
            SysUserRepository sysUserRepository,
            SysEmployeeRepository sysEmployeeRepository,
            SysRoleRepository sysRoleRepository,
            CaptchaService captchaService,
            LoginLockService loginLockService,
            RefreshTokenService refreshTokenService,
            JwtIssuer jwtIssuer,
            JwtVerifier jwtVerifier,
            JwtProperties jwtProperties,
            TokenBlacklistService tokenBlacklistService,
            PasswordEncoder passwordEncoder,
            AuthProperties authProperties,
            StringRedisTemplate redisTemplate) {
        this.sysAppRepository = sysAppRepository;
        this.sysUserRepository = sysUserRepository;
        this.sysEmployeeRepository = sysEmployeeRepository;
        this.sysRoleRepository = sysRoleRepository;
        this.captchaService = captchaService;
        this.loginLockService = loginLockService;
        this.refreshTokenService = refreshTokenService;
        this.jwtIssuer = jwtIssuer;
        this.jwtVerifier = jwtVerifier;
        this.jwtProperties = jwtProperties;
        this.tokenBlacklistService = tokenBlacklistService;
        this.passwordEncoder = passwordEncoder;
        this.authProperties = authProperties;
        this.redisTemplate = redisTemplate;
    }

    /**
     * 登录：验证码 → 账号锁定检查 → 密码校验 → 签发 Access + Refresh。
     * Refresh 明文仅通过 HttpOnly Cookie 返回，不落响应 body。
     */
    @Transactional
    public LoginResult login(LoginRequest request) {
        SysApp app = sysAppRepository.findByCodeAndStatus(request.appCode(), 1)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "APP 不存在"));

        loginLockService.checkLocked(app.getTenantId(), app.getId(), request.username());

        if (authProperties.isCaptchaEnabled()) {
            captchaService.validate(request.captchaId(), request.captchaCode());
        }

        SysUser user = sysUserRepository
                .findByTenantIdAndAppIdAndUsernameAndStatus(app.getTenantId(), app.getId(), request.username(), 1)
                .orElseThrow(() -> handleLoginFailure(app.getTenantId(), app.getId(), request.username()));

        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw handleLoginFailure(app.getTenantId(), app.getId(), request.username());
        }

        loginLockService.clearFailures(app.getTenantId(), app.getId(), request.username());

        List<String> roles = sysRoleRepository.findRoleCodesByUserId(user.getId());
        long permVersion = loadPermVersion(user.getTenantId(), app.getId(), user.getId());
        IssuedAccessToken accessToken = issueAccessToken(user, app, roles, permVersion);
        String refreshToken = refreshTokenService.issue(user.getId(), app.getId());

        SysEmployee employee = sysEmployeeRepository.findById(user.getEmployeeId()).orElse(null);
        String realName = employee != null ? employee.getRealName() : user.getUsername();
        String deptId = employee != null ? String.valueOf(employee.getDeptId()) : null;

        LoginResponse response = new LoginResponse(
                accessToken.token(),
                accessToken.expiresInSeconds(),
                new LoginResponse.AppInfo(String.valueOf(app.getId()), app.getCode(), app.getName()),
                new LoginResponse.UserInfo(
                        String.valueOf(user.getId()),
                        String.valueOf(user.getEmployeeId()),
                        user.getUsername(),
                        realName,
                        null,
                        deptId,
                        null,
                        roles,
                        user.mustChangePassword()));

        return new LoginResult(response, refreshToken, app.getCode());
    }

    /**
     * 刷新：轮换 Refresh（旧 token 吊销 + 发新 token），并签发新 Access。
     * 见 ADR-002 Refresh Token 轮换策略。
     */
    @Transactional
    public RefreshResult refresh(String rawRefreshToken) {
        RefreshTokenService.RotateResult rotated = refreshTokenService.rotate(rawRefreshToken);
        SysUser user = sysUserRepository.findById(rotated.context().userId())
                .orElseThrow(() -> new BusinessException(ResultCode.UNAUTHORIZED));
        SysApp app = sysAppRepository.findById(rotated.context().appId())
                .orElseThrow(() -> new BusinessException(ResultCode.UNAUTHORIZED));

        List<String> roles = sysRoleRepository.findRoleCodesByUserId(user.getId());
        long permVersion = loadPermVersion(user.getTenantId(), app.getId(), user.getId());
        IssuedAccessToken accessToken = issueAccessToken(user, app, roles, permVersion);

        return new RefreshResult(
                new TokenResponse(accessToken.token(), accessToken.expiresInSeconds()),
                rotated.refreshToken(),
                app.getCode());
    }

    /**
     * 登出：Access Token jti 入 Redis 黑名单 + 吊销 Refresh（DB + Redis）。
     */
    @Transactional
    public void logout(String authorizationHeader, String rawRefreshToken) {
        if (authorizationHeader != null && authorizationHeader.startsWith(SecurityConstants.BEARER_PREFIX)) {
            String token = authorizationHeader.substring(SecurityConstants.BEARER_PREFIX.length()).trim();
            try {
                JwtClaims claims = jwtVerifier.verify(token);
                // Phase 1：TTL 取配置 TTL；精确剩余时间可在后续从 exp claim 计算
                Duration ttl = Duration.ofSeconds(jwtProperties.getAccessTokenTtlSeconds());
                tokenBlacklistService.blacklist(claims.jti(), ttl);
            } catch (RuntimeException ignored) {
                // 已过期或无效 token 无需写入黑名单
            }
        }
        refreshTokenService.revoke(rawRefreshToken);
    }

    private IssuedAccessToken issueAccessToken(
            SysUser user,
            SysApp app,
            List<String> roles,
            long permVersion) {
        return jwtIssuer.issue(new AccessTokenClaims(
                user.getId(),
                user.getTenantId(),
                app.getId(),
                user.getEmployeeId(),
                user.getUsername(),
                roles,
                permVersion));
    }

    /** 权限版本号由 mis-rbac 维护；未登录写入 Redis 前默认为 1 */
    private long loadPermVersion(Long tenantId, Long appId, Long userId) {
        String key = CacheConstants.RBAC_PERM_VERSION.formatted(tenantId, appId, userId);
        String value = redisTemplate.opsForValue().get(key);
        if (value == null || value.isBlank()) {
            return 1L;
        }
        return Long.parseLong(value);
    }

    /** 统一返回 LOGIN_FAILED，避免泄露用户是否存在；同时累计 Redis 失败次数 */
    private BusinessException handleLoginFailure(Long tenantId, Long appId, String username) {
        loginLockService.recordFailure(tenantId, appId, username);
        return new BusinessException(ResultCode.LOGIN_FAILED);
    }

    public record LoginResult(LoginResponse response, String refreshToken, String appCode) {
    }

    public record RefreshResult(TokenResponse response, String refreshToken, String appCode) {
    }
}
