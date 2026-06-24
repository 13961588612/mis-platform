package com.mis.common.security.jwt;

import org.springframework.util.StringUtils;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * 根据 {@link JwtProperties} 创建 {@link JwtVerifier}。
 */
public final class JwtVerifierFactory {

    private JwtVerifierFactory() {
    }

    public static JwtVerifier create(JwtProperties properties) {
        if (StringUtils.hasText(properties.getPublicKeyPem())) {
            return new RsaJwtVerifier(PemPublicKeyLoader.load(properties.getPublicKeyPem()));
        }
        if (properties.getPublicKeyResource() != null) {
            try {
                String pem = properties.getPublicKeyResource().getContentAsString(StandardCharsets.UTF_8);
                return new RsaJwtVerifier(PemPublicKeyLoader.load(pem));
            } catch (IOException ex) {
                throw new JwtAuthenticationException(
                        com.mis.common.core.exception.ResultCode.INTERNAL_ERROR,
                        "Cannot read JWT public key resource",
                        ex);
            }
        }
        if (StringUtils.hasText(properties.getPublicKeyPath())) {
            String path = properties.getPublicKeyPath();
            if (path.startsWith("classpath:")) {
                throw new JwtAuthenticationException(
                        com.mis.common.core.exception.ResultCode.INTERNAL_ERROR,
                        "Use mis.security.jwt.public-key-resource for classpath keys");
            }
            return new RsaJwtVerifier(PemPublicKeyLoader.loadFromPath(path));
        }
        throw new IllegalStateException("JWT public key is not configured");
    }
}
