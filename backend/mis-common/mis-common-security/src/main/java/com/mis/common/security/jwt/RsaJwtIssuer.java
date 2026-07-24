package com.mis.common.security.jwt;

import com.mis.common.core.exception.ResultCode;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

import java.security.interfaces.RSAPrivateKey;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.UUID;

/**
 * 使用 RSA 私钥签发 Access Token（RS256）。
 * <p>
 * <b>仅 mis-auth 部署私钥</b>；与 Gateway 公钥配对验签。
 * <p>
 * JWT 载荷约定（见 ADR-002/009/011）：
 * <ul>
 *   <li>含：userId(sub)、tenantId、appId、employeeId、username、roles、permVersion、jti</li>
 *   <li>不含：permissions 数组（运行时由 BFF 读 Redis）</li>
 * </ul>
 * 每次签发生成唯一 {@code jti}，供登出写入 Redis 黑名单。
 */
public class RsaJwtIssuer implements JwtIssuer {

    private final RSAPrivateKey privateKey;
    private final long accessTokenTtlSeconds;

    public RsaJwtIssuer(RSAPrivateKey privateKey, long accessTokenTtlSeconds) {
        this.privateKey = privateKey;
        this.accessTokenTtlSeconds = accessTokenTtlSeconds;
    }

    @Override
    public IssuedAccessToken issue(AccessTokenClaims claims) {
        try {
            String jti = UUID.randomUUID().toString();
            Instant now = Instant.now();
            Instant expiry = now.plusSeconds(accessTokenTtlSeconds);

            JWTClaimsSet.Builder builder = new JWTClaimsSet.Builder()
                    .subject(String.valueOf(claims.userId()))
                    .issuer("mis-platform")   // T1：补 iss（向后兼容；旧 token 无 iss 仍可被平台软比对接受）
                    .jwtID(jti)
                    .issueTime(Date.from(now))
                    .expirationTime(Date.from(expiry))
                    .claim("tenantId", claims.tenantId())
                    .claim("appId", claims.appId())
                    .claim("employeeId", claims.employeeId())
                    .claim("username", claims.username())
                    .claim("permVersion", claims.permVersion());

            List<String> roles = claims.roles();
            if (roles != null && !roles.isEmpty()) {
                builder.claim("roles", roles);
            }

            SignedJWT signedJwt = new SignedJWT(new JWSHeader(JWSAlgorithm.RS256), builder.build());
            signedJwt.sign(new RSASSASigner(privateKey));
            return new IssuedAccessToken(signedJwt.serialize(), jti, accessTokenTtlSeconds);
        } catch (Exception ex) {
            throw new JwtAuthenticationException(ResultCode.INTERNAL_ERROR, "Failed to issue JWT", ex);
        }
    }
}
