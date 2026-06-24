package com.mis.common.security.jwt;

import java.util.List;

/**
 * Access Token 签发载荷（不含 permissions，ADR-009）。
 */
public record AccessTokenClaims(
        long userId,
        long tenantId,
        long appId,
        long employeeId,
        String username,
        List<String> roles,
        long permVersion
) {
}
