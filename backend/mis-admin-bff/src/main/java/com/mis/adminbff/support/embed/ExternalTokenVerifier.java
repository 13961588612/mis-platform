package com.mis.adminbff.support.embed;

import com.nimbusds.jose.JWSVerifier;
import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.Date;

/**
 * externalToken（HS256）验签与 claims 提取。
 *
 * <p>安全要求（01-architecture §4.5 R1-R4）：
 * <ul>
 *   <li>R1：绝不单独凭「手机号 + app」签发 token——本类只负责验签，手机号只作匹配键；</li>
 *   <li>R4：验签失败 / 过期 / 缺外部用户标识一律抛 {@link InvalidExternalTokenException}，
 *       调用方统一返回 40101 且不区分提示（防枚举）。</li>
 * </ul>
 *
 * <p>payload 约定（宿主签发方与 BFF 对齐）：
 * <pre>
 * { "iss": "crm-web", "appId": "crm-web", "externalUserId": "crm-00123",
 *   "phone": "13800138000", "iat": ..., "exp": ... }
 * </pre>
 */
@Component
public class ExternalTokenVerifier {

    /**
     * 验签并提取 claims。
     *
     * @param token        externalToken 字符串
     * @param clientSecret 宿主共享密钥明文（HS256 验签密钥）
     * @param expectedHost 期望 hostId（与 token 内 iss/appId 一致性校验，P4）
     * @return 验签通过后的 claims
     * @throws InvalidExternalTokenException 验签失败 / 过期 / 缺外部用户标识 / hostId 不一致
     */
    public ExternalTokenClaims verify(String token, String clientSecret, String expectedHost)
            throws InvalidExternalTokenException {
        if (token == null || token.isBlank()) {
            throw new InvalidExternalTokenException("externalToken 为空");
        }
        if (clientSecret == null || clientSecret.isBlank()) {
            throw new InvalidExternalTokenException("client_secret 未配置");
        }

        SignedJWT signedJwt;
        try {
            signedJwt = SignedJWT.parse(token);
        } catch (Exception ex) {
            throw new InvalidExternalTokenException("externalToken 格式非法");
        }

        JWSVerifier verifier;
        try {
            verifier = new MACVerifier(clientSecret.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ex) {
            throw new InvalidExternalTokenException("client_secret 无法用于 HS256 验签");
        }

        boolean valid;
        try {
            valid = signedJwt.verify(verifier);
        } catch (Exception ex) {
            throw new InvalidExternalTokenException("externalToken 验签异常");
        }
        if (!valid) {
            throw new InvalidExternalTokenException("externalToken 签名校验失败");
        }

        JWTClaimsSet claims;
        try {
            claims = signedJwt.getJWTClaimsSet();
        } catch (Exception ex) {
            throw new InvalidExternalTokenException("externalToken claims 解析失败");
        }

        // 过期校验（R4：过期一律拒绝）
        Date exp = claims.getExpirationTime();
        if (exp == null || exp.getTime() <= System.currentTimeMillis()) {
            throw new InvalidExternalTokenException("externalToken 已过期");
        }

        // 身份一致性（P4：token 内为准；请求体 hostId 必须与 token 内 iss/appId 之一匹配）
        String appId = getClaimAsString(claims, "appId");
        String issuer = claims.getIssuer();
        if (appId == null || !appId.equals(expectedHost)) {
            if (issuer == null || !issuer.equals(expectedHost)) {
                throw new InvalidExternalTokenException("externalToken 与 hostId 不一致");
            }
        }

        // 外部用户标识必填（映射键）
        String externalUserId = getClaimAsString(claims, "externalUserId");
        if (externalUserId == null || externalUserId.isBlank()) {
            throw new InvalidExternalTokenException("externalToken 缺少 externalUserId");
        }

        String phone = getClaimAsString(claims, "phone");
        long expiresAt = exp.getTime() / 1000;

        return new ExternalTokenClaims(
                appId != null ? appId : issuer,
                expectedHost,
                externalUserId.trim(),
                phone != null ? phone.trim() : null,
                expiresAt);
    }

    /**
     * null 安全地读取字符串型 claim。
     *
     * <p>nimbus {@link JWTClaimsSet#getStringClaim(String)} 在 claim 存在但类型不符时会抛
     * {@link java.text.ParseException}（受检异常），与本类方法契约（仅抛
     * {@link InvalidExternalTokenException}）冲突；这里改用 {@link JWTClaimsSet#getClaim(String)}
     * + instanceof 判断，缺失或类型不符统一返回 null，由调用方按「缺字段」语义处理，
     * 与既有 40101 路径保持一致。
     */
    private static String getClaimAsString(JWTClaimsSet claims, String name) {
        Object value = claims.getClaim(name);
        return value instanceof String ? (String) value : null;
    }

    /** externalToken 无效（签名不符 / 过期 / 缺字段 / host 不一致），统一 40101。 */
    public static final class InvalidExternalTokenException extends Exception {
        public InvalidExternalTokenException(String message) {
            super(message);
        }
    }
}
