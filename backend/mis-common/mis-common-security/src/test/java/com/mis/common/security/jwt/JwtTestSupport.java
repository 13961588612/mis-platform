package com.mis.common.security.jwt;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.UUID;

/**
 * 测试用 RSA 密钥对与 JWT 签发（仅 test scope 使用）。
 */
public final class JwtTestSupport {

    private static final KeyPair KEY_PAIR = generateKeyPair();
    private static final String PUBLIC_PEM = toPublicPem((RSAPublicKey) KEY_PAIR.getPublic());

    private JwtTestSupport() {
    }

    public static String publicKeyPem() {
        return PUBLIC_PEM;
    }

    public static String privateKeyPem() {
        return toPrivatePem((RSAPrivateKey) KEY_PAIR.getPrivate());
    }

    public static JwtVerifier verifier() {
        return new RsaJwtVerifier((RSAPublicKey) KEY_PAIR.getPublic());
    }

    public static RSAPrivateKey privateKey() {
        return (RSAPrivateKey) KEY_PAIR.getPrivate();
    }

    public static String accessToken(long userId, long tenantId, long appId) {
        return accessToken(userId, tenantId, appId, 1L, "tester");
    }

    public static String accessToken(
            long userId,
            long tenantId,
            long appId,
            long employeeId,
            String username) {
        try {
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .subject(String.valueOf(userId))
                    .claim("tenantId", tenantId)
                    .claim("appId", appId)
                    .claim("employeeId", employeeId)
                    .claim("username", username)
                    .jwtID(UUID.randomUUID().toString())
                    .issueTime(Date.from(Instant.now()))
                    .expirationTime(Date.from(Instant.now().plusSeconds(7200)))
                    .build();
            SignedJWT signedJwt = new SignedJWT(new JWSHeader(JWSAlgorithm.RS256), claims);
            signedJwt.sign(new RSASSASigner((RSAPrivateKey) KEY_PAIR.getPrivate()));
            return signedJwt.serialize();
        } catch (Exception ex) {
            throw new IllegalStateException("Failed to sign test JWT", ex);
        }
    }

    private static KeyPair generateKeyPair() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            return generator.generateKeyPair();
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    private static String toPublicPem(RSAPublicKey publicKey) {
        String base64 = Base64.getMimeEncoder(64, "\n".getBytes())
                .encodeToString(publicKey.getEncoded());
        return "-----BEGIN PUBLIC KEY-----\n" + base64 + "\n-----END PUBLIC KEY-----\n";
    }

    private static String toPrivatePem(RSAPrivateKey privateKey) {
        String base64 = Base64.getMimeEncoder(64, "\n".getBytes())
                .encodeToString(privateKey.getEncoded());
        return "-----BEGIN PRIVATE KEY-----\n" + base64 + "\n-----END PRIVATE KEY-----\n";
    }
}
