package com.mis.common.redis.auth;

import com.mis.common.security.jwt.TokenBlacklistChecker;

/**
 * Redis 实现的 jti 黑名单检查（Gateway 验签后调用）。
 */
public class RedisTokenBlacklistChecker implements TokenBlacklistChecker {

    private final TokenBlacklistService tokenBlacklistService;

    public RedisTokenBlacklistChecker(TokenBlacklistService tokenBlacklistService) {
        this.tokenBlacklistService = tokenBlacklistService;
    }

    @Override
    public boolean isBlacklisted(String jti) {
        return tokenBlacklistService.isBlacklisted(jti);
    }
}
