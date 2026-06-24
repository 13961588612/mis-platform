package com.mis.common.security.jwt;

/**
 * JWT Access Token 签发（RS256，mis-auth 使用）。
 */
public interface JwtIssuer {

    IssuedAccessToken issue(AccessTokenClaims claims);
}
