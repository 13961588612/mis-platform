package com.mis.auth.service;

import com.mis.auth.config.AuthProperties;
import com.mis.auth.domain.entity.RefreshTokenEntity;
import com.mis.auth.domain.repository.RefreshTokenRepository;
import com.mis.auth.support.IdGenerator;
import com.mis.auth.support.TokenUtils;
import com.mis.common.core.constant.CacheConstants;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.security.jwt.JwtProperties;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;

/**
 * Refresh Token 生命周期：签发、轮换、吊销。
 * <p>
 * <b>双写</b>（ADR-002）：
 * <ul>
 *   <li>PostgreSQL {@code sys_refresh_token}：存 SHA-256 hash + 明文 {@code token_value}（Phase 1 联调核对）</li>
 *   <li>Redis {@link CacheConstants#AUTH_REFRESH}：快速校验，TTL 与 Refresh 一致</li>
 * </ul>
 * 客户端仅持有明文 Refresh；Cookie 名 {@code mis_refresh_{appCode}}。
 */
@Service
public class RefreshTokenService {

    public record RefreshContext(Long userId, Long appId) {
    }

    public record RotateResult(RefreshContext context, String refreshToken) {
    }

    private final RefreshTokenRepository refreshTokenRepository;
    private final StringRedisTemplate redisTemplate;
    private final JwtProperties jwtProperties;
    private final AuthProperties authProperties;

    public RefreshTokenService(
            RefreshTokenRepository refreshTokenRepository,
            StringRedisTemplate redisTemplate,
            JwtProperties jwtProperties,
            AuthProperties authProperties) {
        this.refreshTokenRepository = refreshTokenRepository;
        this.redisTemplate = redisTemplate;
        this.jwtProperties = jwtProperties;
        this.authProperties = authProperties;
    }

    @Transactional
    public String issue(Long userId, Long appId) {
        String rawToken = TokenUtils.generateRefreshToken();
        persist(rawToken, userId, appId);
        return rawToken;
    }

    /**
     * 轮换：验证旧 token → 吊销 → 签发新 token（防止 Refresh 重放）。
     */
    @Transactional
    public RotateResult rotate(String rawToken) {
        RefreshTokenEntity existing = loadActive(rawToken);
        revoke(rawToken);
        String newRaw = TokenUtils.generateRefreshToken();
        persist(newRaw, existing.getUserId(), existing.getAppId());
        return new RotateResult(new RefreshContext(existing.getUserId(), existing.getAppId()), newRaw);
    }

    @Transactional
    public RefreshContext validate(String rawToken) {
        RefreshTokenEntity entity = loadActive(rawToken);
        return new RefreshContext(entity.getUserId(), entity.getAppId());
    }

    /** 登出或轮换时：DB revoked=1 + 删除 Redis 缓存 */
    @Transactional
    public void revoke(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) {
            return;
        }
        String hash = TokenUtils.hashToken(rawToken);
        refreshTokenRepository.revokeByTokenHash(hash);
        redisTemplate.delete(CacheConstants.AUTH_REFRESH.formatted(hash));
    }

    public Duration refreshTtl() {
        long seconds = jwtProperties.getRefreshTokenTtlSeconds();
        return Duration.ofSeconds(seconds > 0 ? seconds : 604800);
    }

    /** 每 APP 独立 Cookie，避免多 APP 同域冲突 */
    public String cookieName(String appCode) {
        return authProperties.getRefreshCookiePrefix() + appCode;
    }

    private RefreshTokenEntity loadActive(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) {
            throw new BusinessException(ResultCode.REFRESH_TOKEN_INVALID, "Missing refresh token");
        }
        String hash = TokenUtils.hashToken(rawToken);
        RefreshTokenEntity entity = refreshTokenRepository.findByTokenHashAndRevoked(hash, 0)
                .orElseThrow(() -> new BusinessException(ResultCode.REFRESH_TOKEN_INVALID, "Invalid refresh token"));
        if (entity.getExpireAt().isBefore(Instant.now())) {
            throw new BusinessException(ResultCode.REFRESH_TOKEN_EXPIRED, "Refresh token expired");
        }
        return entity;
    }

    private void persist(String rawToken, Long userId, Long appId) {
        String hash = TokenUtils.hashToken(rawToken);
        Duration ttl = refreshTtl();
        RefreshTokenEntity entity = new RefreshTokenEntity();
        entity.setId(IdGenerator.nextId());
        entity.setUserId(userId);
        entity.setAppId(appId);
        entity.setTokenHash(hash);
        entity.setTokenValue(rawToken);
        entity.setClientId(authProperties.getDefaultClientId());
        entity.setExpireAt(Instant.now().plus(ttl));
        entity.setRevoked(0);
        refreshTokenRepository.save(entity);
        redisTemplate.opsForValue().set(
                CacheConstants.AUTH_REFRESH.formatted(hash),
                userId + ":" + appId,
                ttl);
    }
}
