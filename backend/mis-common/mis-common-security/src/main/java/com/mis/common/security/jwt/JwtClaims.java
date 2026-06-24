package com.mis.common.security.jwt;

/**
 * JWT Access Token 解析后的身份声明（RS256，ADR-002/011）。
 */
public record JwtClaims(
        Long userId,
        Long tenantId,
        Long appId,
        Long employeeId,
        String username,
        String jti
) {
}
