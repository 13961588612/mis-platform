package com.mis.common.security.jwt;

import com.mis.common.core.exception.ResultCode;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.JWSVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

import java.security.interfaces.RSAPublicKey;
import java.text.ParseException;
import java.util.Date;

/**
 * 使用 RSA 公钥验签 Access Token（RS256），并解析 MIS 自定义 claims。
 * <p>
 * Gateway、mis-auth（logout 解析 jti）等只持有<strong>公钥</strong>；私钥仅在 mis-auth 签发侧。
 * <p>
 * 解析字段映射见 {@link JwtClaims}；JWT 内可含 roles/permVersion，但 Gateway 仅透传身份头，
 * 不解析 permissions（ADR-009）。
 */
public class RsaJwtVerifier implements JwtVerifier {

    private final RSAPublicKey publicKey;

    public RsaJwtVerifier(RSAPublicKey publicKey) {
        this.publicKey = publicKey;
    }

    @Override
    public JwtClaims verify(String token) {
        if (token == null || token.isBlank()) {
            throw new JwtAuthenticationException(ResultCode.UNAUTHORIZED, "Missing access token");
        }
        try {
            SignedJWT signedJwt = SignedJWT.parse(token.trim());
            JWSVerifier verifier = new RSASSAVerifier(publicKey);
            if (!signedJwt.verify(verifier)) {
                throw new JwtAuthenticationException(ResultCode.TOKEN_INVALID, "Invalid JWT signature");
            }

            JWTClaimsSet claims = signedJwt.getJWTClaimsSet();
            Date expiration = claims.getExpirationTime();
            if (expiration != null && expiration.before(new Date())) {
                throw new JwtAuthenticationException(ResultCode.TOKEN_EXPIRED, "Access token expired");
            }

            return new JwtClaims(
                    parseLongClaim(claims, "sub", true),
                    parseLongClaim(claims, "tenantId", false),
                    parseLongClaim(claims, "appId", false),
                    parseLongClaim(claims, "employeeId", false),
                    parseStringClaim(claims, "username"),
                    claims.getJWTID()
            );
        } catch (ParseException | JOSEException ex) {
            throw new JwtAuthenticationException(ResultCode.TOKEN_INVALID, "Invalid JWT", ex);
        }
    }

    private static Long parseLongClaim(JWTClaimsSet claims, String name, boolean required) {
        Object value = claims.getClaim(name);
        if (value == null) {
            if ("sub".equals(name) && claims.getSubject() != null) {
                return Long.parseLong(claims.getSubject());
            }
            if (required) {
                throw new JwtAuthenticationException(ResultCode.TOKEN_INVALID, "Missing claim: " + name);
            }
            return null;
        }
        if (value instanceof Number number) {
            return number.longValue();
        }
        return Long.parseLong(String.valueOf(value));
    }

    private static String parseStringClaim(JWTClaimsSet claims, String name) {
        Object value = claims.getClaim(name);
        return value != null ? String.valueOf(value) : null;
    }
}
