package com.mis.common.security.jwt;

/**
 * 未接入 Redis 时跳过 jti 黑名单检查。
 */
public class NoOpTokenBlacklistChecker implements TokenBlacklistChecker {

    @Override
    public boolean isBlacklisted(String jti) {
        return false;
    }
}
