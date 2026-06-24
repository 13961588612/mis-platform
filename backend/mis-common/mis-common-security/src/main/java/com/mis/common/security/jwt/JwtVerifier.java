package com.mis.common.security.jwt;

/**
 * Access Token 验签（RS256 公钥）。
 */
public interface JwtVerifier {

    JwtClaims verify(String token);
}
