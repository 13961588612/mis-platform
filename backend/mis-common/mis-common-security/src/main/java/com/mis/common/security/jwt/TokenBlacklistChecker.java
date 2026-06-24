package com.mis.common.security.jwt;

/**
 * 登出后 jti 黑名单（Redis {@code mis:auth:token:blacklist:{jti}}）。
 */
public interface TokenBlacklistChecker {

    boolean isBlacklisted(String jti);
}
