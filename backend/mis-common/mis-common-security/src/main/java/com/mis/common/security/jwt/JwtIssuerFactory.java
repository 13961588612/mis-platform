package com.mis.common.security.jwt;

import org.springframework.util.StringUtils;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * 根据 {@link JwtProperties} 创建 {@link JwtIssuer}。
 */
public final class JwtIssuerFactory {

    private JwtIssuerFactory() {
    }

    public static JwtIssuer create(JwtProperties properties) {
        RSAPrivateKeyHolder key = resolvePrivateKey(properties);
        long ttl = properties.getAccessTokenTtlSeconds() > 0
                ? properties.getAccessTokenTtlSeconds()
                : 7200L;
        return new RsaJwtIssuer(key.privateKey(), ttl);
    }

    private static RSAPrivateKeyHolder resolvePrivateKey(JwtProperties properties) {
        if (StringUtils.hasText(properties.getPrivateKeyPem())) {
            return new RSAPrivateKeyHolder(PemPrivateKeyLoader.load(properties.getPrivateKeyPem()));
        }
        if (properties.getPrivateKeyResource() != null) {
            try {
                String pem = properties.getPrivateKeyResource().getContentAsString(StandardCharsets.UTF_8);
                return new RSAPrivateKeyHolder(PemPrivateKeyLoader.load(pem));
            } catch (IOException ex) {
                throw new JwtAuthenticationException(
                        com.mis.common.core.exception.ResultCode.INTERNAL_ERROR,
                        "Cannot read JWT private key resource",
                        ex);
            }
        }
        if (StringUtils.hasText(properties.getPrivateKeyPath())) {
            String path = properties.getPrivateKeyPath();
            if (path.startsWith("classpath:")) {
                throw new JwtAuthenticationException(
                        com.mis.common.core.exception.ResultCode.INTERNAL_ERROR,
                        "Use mis.security.jwt.private-key-resource for classpath keys");
            }
            return new RSAPrivateKeyHolder(PemPrivateKeyLoader.loadFromPath(path));
        }
        throw new IllegalStateException("JWT private key is not configured");
    }

    private record RSAPrivateKeyHolder(java.security.interfaces.RSAPrivateKey privateKey) {
    }
}
