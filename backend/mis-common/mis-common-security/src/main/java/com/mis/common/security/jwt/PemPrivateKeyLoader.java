package com.mis.common.security.jwt;

import com.mis.common.core.exception.ResultCode;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.NoSuchAlgorithmException;
import java.security.interfaces.RSAPrivateKey;
import java.security.spec.InvalidKeySpecException;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;

/**
 * 从 PEM 加载 RSA 私钥。
 */
public final class PemPrivateKeyLoader {

    private PemPrivateKeyLoader() {
    }

    public static RSAPrivateKey load(String pem) {
        try {
            String normalized = pem
                    .replace("-----BEGIN PRIVATE KEY-----", "")
                    .replace("-----END PRIVATE KEY-----", "")
                    .replace("-----BEGIN RSA PRIVATE KEY-----", "")
                    .replace("-----END RSA PRIVATE KEY-----", "")
                    .replaceAll("\\s", "");
            byte[] decoded = Base64.getDecoder().decode(normalized);
            PKCS8EncodedKeySpec spec = new PKCS8EncodedKeySpec(decoded);
            KeyFactory keyFactory = KeyFactory.getInstance("RSA");
            return (RSAPrivateKey) keyFactory.generatePrivate(spec);
        } catch (NoSuchAlgorithmException | InvalidKeySpecException ex) {
            throw new JwtAuthenticationException(ResultCode.INTERNAL_ERROR, "Failed to load JWT private key", ex);
        }
    }

    public static RSAPrivateKey loadFromPath(String path) {
        try {
            String pem = Files.readString(Path.of(path), StandardCharsets.UTF_8);
            return load(pem);
        } catch (IOException ex) {
            throw new JwtAuthenticationException(ResultCode.INTERNAL_ERROR, "Cannot read JWT private key: " + path, ex);
        }
    }
}
