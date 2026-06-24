package com.mis.common.security.jwt;

/**
 * 已签发的 Access Token。
 */
public record IssuedAccessToken(
        String token,
        String jti,
        long expiresInSeconds
) {
}
