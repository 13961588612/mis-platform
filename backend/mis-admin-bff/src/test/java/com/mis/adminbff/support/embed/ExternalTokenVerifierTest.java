package com.mis.adminbff.support.embed;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link ExternalTokenVerifier} 单测（R1/R4：HS256 验签 + 过期 + hostId 一致性）。
 */
class ExternalTokenVerifierTest {

    // HS256 要求密钥 ≥ 256 bits（32 字节）；两个密钥均取 44/45 字节，且互不相同
    private static final String SECRET = "test-secret-0123456789abcdef0123456789abcdef";
    private static final String WRONG_SECRET = "wrong-secret-0123456789abcdef0123456789abcdef";
    private static final String HOST = "crm-web";

    private final ExternalTokenVerifier verifier = new ExternalTokenVerifier();

    private static String sign(String secret, JWTClaimsSet claims) throws Exception {
        SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
        jwt.sign(new MACSigner(secret.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        return jwt.serialize();
    }

    private static JWTClaimsSet claims(long ttlSeconds, String appId, String issuer, String externalUserId, String phone) {
        long now = System.currentTimeMillis();
        return new JWTClaimsSet.Builder()
                .issuer(issuer)
                .claim("appId", appId)
                .claim("externalUserId", externalUserId)
                .claim("phone", phone)
                .issueTime(new Date(now))
                .expirationTime(new Date(now + ttlSeconds * 1000))
                .build();
    }

    @Test
    @DisplayName("合法 token 验签通过，claims 提取正确（appId/externalUserId/phone）")
    void validToken() throws Exception {
        String token = sign(SECRET, claims(300, HOST, HOST, "crm-00123", "13800138000"));

        ExternalTokenClaims result = verifier.verify(token, SECRET, HOST);

        assertEquals(HOST, result.appId());
        assertEquals("crm-00123", result.externalUserId());
        assertEquals("13800138000", result.phone());
        assertTrue(result.expiresAt() > System.currentTimeMillis() / 1000);
    }

    @Test
    @DisplayName("R4：签名不符 → 拒绝（密钥错误）")
    void wrongSecret() throws Exception {
        String token = sign(SECRET, claims(300, HOST, HOST, "crm-00123", null));
        // 用错误密钥验签失败；verify 内部用配置 secret，这里直接验证 MACVerifier 行为
        assertThrows(ExternalTokenVerifier.InvalidExternalTokenException.class,
                () -> verifier.verify(token, WRONG_SECRET, HOST));
    }

    @Test
    @DisplayName("R4：过期 token → 拒绝")
    void expiredToken() throws Exception {
        String token = sign(SECRET, claims(-10, HOST, HOST, "crm-00123", null));

        assertThrows(ExternalTokenVerifier.InvalidExternalTokenException.class,
                () -> verifier.verify(token, SECRET, HOST));
    }

    @Test
    @DisplayName("P4：token 内 appId/iss 与请求 hostId 不一致 → 拒绝")
    void hostMismatch() throws Exception {
        String token = sign(SECRET, claims(300, "other-app", "other-app", "crm-00123", null));

        assertThrows(ExternalTokenVerifier.InvalidExternalTokenException.class,
                () -> verifier.verify(token, SECRET, HOST));
    }

    @Test
    @DisplayName("缺 externalUserId → 拒绝（映射键缺失）")
    void missingExternalUserId() throws Exception {
        String token = sign(SECRET, claims(300, HOST, HOST, null, null));

        assertThrows(ExternalTokenVerifier.InvalidExternalTokenException.class,
                () -> verifier.verify(token, SECRET, HOST));
    }

    @Test
    @DisplayName("空白 token / 空白 secret → 拒绝")
    void blankInputs() {
        assertThrows(ExternalTokenVerifier.InvalidExternalTokenException.class,
                () -> verifier.verify("", SECRET, HOST));
        assertThrows(ExternalTokenVerifier.InvalidExternalTokenException.class,
                () -> verifier.verify("a.b.c", "", HOST));
    }

    @Test
    @DisplayName("iss 匹配而 appId 缺失时仍通过（兼容宿主只签 iss 的形态）")
    void issuerFallback() throws Exception {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .issuer(HOST)
                .claim("externalUserId", "crm-00123")
                .issueTime(new Date(System.currentTimeMillis()))
                .expirationTime(new Date(System.currentTimeMillis() + 300_000))
                .build();
        String token = sign(SECRET, claims);

        ExternalTokenClaims result = verifier.verify(token, SECRET, HOST);

        assertEquals(HOST, result.appId());
        assertEquals("crm-00123", result.externalUserId());
        assertNull(result.phone());
    }
}
