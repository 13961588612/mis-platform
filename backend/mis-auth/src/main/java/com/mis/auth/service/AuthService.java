package com.mis.auth.service;

import com.mis.auth.client.AuditLoginLogClient;
import com.mis.auth.client.IamUserClient;
import com.mis.auth.client.IamUserClient.AuthUserPayload;
import com.mis.auth.config.AuthProperties;
import com.mis.auth.domain.entity.SysApp;
import com.mis.auth.domain.repository.SysAppRepository;
import com.mis.auth.dto.LoginClientInfo;
import com.mis.auth.dto.LoginRequest;
import com.mis.auth.dto.LoginResponse;
import com.mis.auth.dto.TokenResponse;
import com.mis.common.core.constant.SecurityConstants;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.redis.auth.TokenBlacklistService;
import com.mis.common.redis.rbac.PermVersionService;
import com.mis.common.security.jwt.AccessTokenClaims;
import com.mis.common.security.jwt.IssuedAccessToken;
import com.mis.common.security.jwt.JwtClaims;
import com.mis.common.security.jwt.JwtIssuer;
import com.mis.common.security.jwt.JwtProperties;
import com.mis.common.security.jwt.JwtVerifier;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.util.List;

/**
 * 认证核心业务（L0）：登录、刷新、登出。
 * <p>
 * 用户主数据经 RestClient 调 <b>mis-iam</b>（不再直查 {@code sys_user}）。
 * APP 元数据仍本服务只读；Refresh Token 仍落本库。
 */
@Service
public class AuthService {

    private final SysAppRepository sysAppRepository;
    private final IamUserClient iamUserClient;
    private final CaptchaService captchaService;
    private final LoginLockService loginLockService;
    private final RefreshTokenService refreshTokenService;
    private final JwtIssuer jwtIssuer;
    private final JwtVerifier jwtVerifier;
    private final JwtProperties jwtProperties;
    private final TokenBlacklistService tokenBlacklistService;
    private final PasswordEncoder passwordEncoder;
    private final AuthProperties authProperties;
    private final PermVersionService permVersionService;
    private final AuditLoginLogClient auditLoginLogClient;

    public AuthService(
            SysAppRepository sysAppRepository,
            IamUserClient iamUserClient,
            CaptchaService captchaService,
            LoginLockService loginLockService,
            RefreshTokenService refreshTokenService,
            JwtIssuer jwtIssuer,
            JwtVerifier jwtVerifier,
            JwtProperties jwtProperties,
            TokenBlacklistService tokenBlacklistService,
            PasswordEncoder passwordEncoder,
            AuthProperties authProperties,
            PermVersionService permVersionService,
            AuditLoginLogClient auditLoginLogClient) {
        this.sysAppRepository = sysAppRepository;
        this.iamUserClient = iamUserClient;
        this.captchaService = captchaService;
        this.loginLockService = loginLockService;
        this.refreshTokenService = refreshTokenService;
        this.jwtIssuer = jwtIssuer;
        this.jwtVerifier = jwtVerifier;
        this.jwtProperties = jwtProperties;
        this.tokenBlacklistService = tokenBlacklistService;
        this.passwordEncoder = passwordEncoder;
        this.authProperties = authProperties;
        this.permVersionService = permVersionService;
        this.auditLoginLogClient = auditLoginLogClient;
    }

    @Transactional
    public LoginResult login(LoginRequest request, LoginClientInfo clientInfo) {
        SysApp app = sysAppRepository.findByCodeAndStatus(request.appCode(), 1)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "APP 不存在"));

        try {
            loginLockService.checkLocked(app.getTenantId(), app.getId(), request.username());
        } catch (BusinessException ex) {
            recordLoginLog(app, null, request.username(), 0, ex.getMessage(), clientInfo);
            throw ex;
        }

        if (authProperties.isCaptchaEnabled()) {
            try {
                captchaService.validate(request.captchaId(), request.captchaCode());
            } catch (BusinessException ex) {
                recordLoginLog(app, null, request.username(), 0, ex.getMessage(), clientInfo);
                throw ex;
            }
        }

        AuthUserPayload user = iamUserClient.findByUsername(app.getTenantId(), app.getId(), request.username());
        if (user == null || !user.isActive()) {
            throw handleLoginFailure(app, user != null ? user.userId() : null, request.username(), clientInfo);
        }

        if (!passwordEncoder.matches(request.password(), user.passwordHash())) {
            throw handleLoginFailure(app, user.userId(), request.username(), clientInfo);
        }

        loginLockService.clearFailures(app.getTenantId(), app.getId(), request.username());

        iamUserClient.loadAndCachePermissions(user.userId());

        List<String> roles = user.roleCodes() != null ? user.roleCodes() : List.of();
        long permVersion = resolvePermVersion(user, app);
        IssuedAccessToken accessToken = issueAccessToken(user, app, roles, permVersion);
        String refreshToken = refreshTokenService.issue(user.userId(), app.getId());

        String realName = user.realName() != null && !user.realName().isBlank()
                ? user.realName()
                : user.username();

        recordLoginLog(app, user.userId(), request.username(), 1, "登录成功", clientInfo);

        LoginResponse response = new LoginResponse(
                accessToken.token(),
                accessToken.expiresInSeconds(),
                new LoginResponse.AppInfo(String.valueOf(app.getId()), app.getCode(), app.getName()),
                new LoginResponse.UserInfo(
                        user.id(),
                        user.employeeId(),
                        user.username(),
                        realName,
                        null,
                        user.deptId(),
                        null,
                        roles,
                        user.mustChangePasswordFlag()));

        return new LoginResult(response, refreshToken, app.getCode());
    }

    @Transactional
    public RefreshResult refresh(String rawRefreshToken) {
        RefreshTokenService.RotateResult rotated = refreshTokenService.rotate(rawRefreshToken);
        AuthUserPayload user = iamUserClient.findById(rotated.context().userId());
        if (user == null || !user.isActive()) {
            throw new BusinessException(ResultCode.UNAUTHORIZED);
        }
        SysApp app = sysAppRepository.findById(rotated.context().appId())
                .orElseThrow(() -> new BusinessException(ResultCode.UNAUTHORIZED));

        iamUserClient.loadAndCachePermissions(user.userId());

        List<String> roles = user.roleCodes() != null ? user.roleCodes() : List.of();
        long permVersion = resolvePermVersion(user, app);
        IssuedAccessToken accessToken = issueAccessToken(user, app, roles, permVersion);

        return new RefreshResult(
                new TokenResponse(accessToken.token(), accessToken.expiresInSeconds()),
                rotated.refreshToken(),
                app.getCode());
    }

    @Transactional
    public void logout(String authorizationHeader, String rawRefreshToken) {
        if (authorizationHeader != null && authorizationHeader.startsWith(SecurityConstants.BEARER_PREFIX)) {
            String token = authorizationHeader.substring(SecurityConstants.BEARER_PREFIX.length()).trim();
            try {
                JwtClaims claims = jwtVerifier.verify(token);
                Duration ttl = Duration.ofSeconds(jwtProperties.getAccessTokenTtlSeconds());
                tokenBlacklistService.blacklist(claims.jti(), ttl);
            } catch (RuntimeException ignored) {
                // 已过期或无效 token 无需写入黑名单
            }
        }
        refreshTokenService.revoke(rawRefreshToken);
    }

    @Transactional
    public void changePassword(String authorizationHeader, String oldPassword, String newPassword) {
        if (authorizationHeader == null || !authorizationHeader.startsWith(SecurityConstants.BEARER_PREFIX)) {
            throw new BusinessException(ResultCode.UNAUTHORIZED);
        }
        String token = authorizationHeader.substring(SecurityConstants.BEARER_PREFIX.length()).trim();
        JwtClaims claims;
        try {
            claims = jwtVerifier.verify(token);
        } catch (RuntimeException ex) {
            throw new BusinessException(ResultCode.TOKEN_INVALID);
        }
        if (claims.userId() == null) {
            throw new BusinessException(ResultCode.UNAUTHORIZED);
        }
        if (oldPassword == null || newPassword == null || newPassword.equals(oldPassword)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "新密码不能与旧密码相同");
        }
        if (!newPassword.matches("(?=.*[A-Za-z])(?=.*\\d).{8,64}")) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "新密码须 8–64 位且同时包含字母与数字");
        }

        AuthUserPayload user = iamUserClient.findById(claims.userId());
        if (user == null || !user.isActive()) {
            throw new BusinessException(ResultCode.UNAUTHORIZED);
        }
        if (!passwordEncoder.matches(oldPassword, user.passwordHash())) {
            throw new BusinessException(ResultCode.LOGIN_FAILED, "当前密码不正确");
        }
        iamUserClient.changePassword(user.userId(), newPassword);
    }

    private IssuedAccessToken issueAccessToken(
            AuthUserPayload user,
            SysApp app,
            List<String> roles,
            long permVersion) {
        return jwtIssuer.issue(new AccessTokenClaims(
                user.userId(),
                user.tenantIdLong(),
                app.getId(),
                user.employeeIdLong(),
                user.username(),
                roles,
                permVersion));
    }

    private long resolvePermVersion(AuthUserPayload user, SysApp app) {
        long dbVersion = user.permVersion() != null ? user.permVersion() : 1L;
        return permVersionService.syncCacheFromAuthority(
                user.tenantIdLong(), app.getId(), user.userId(), dbVersion);
    }

    private BusinessException handleLoginFailure(
            SysApp app, Long userId, String username, LoginClientInfo clientInfo) {
        loginLockService.recordFailure(app.getTenantId(), app.getId(), username);
        recordLoginLog(app, userId, username, 0, ResultCode.LOGIN_FAILED.getMessage(), clientInfo);
        return new BusinessException(ResultCode.LOGIN_FAILED);
    }

    private void recordLoginLog(
            SysApp app, Long userId, String username, int status, String msg, LoginClientInfo clientInfo) {
        auditLoginLogClient.recordAsync(
                app.getTenantId(), app.getId(), userId, username, status, msg, clientInfo);
    }

    public record LoginResult(LoginResponse response, String refreshToken, String appCode) {
    }

    public record RefreshResult(TokenResponse response, String refreshToken, String appCode) {
    }
}
