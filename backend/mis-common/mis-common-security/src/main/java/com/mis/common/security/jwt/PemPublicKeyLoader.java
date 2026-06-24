package com.mis.common.security.jwt;

import com.mis.common.core.exception.ResultCode;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.NoSuchAlgorithmException;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.InvalidKeySpecException;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;

/**
 * 从 PEM 加载 RSA 公钥。
 */
public final class PemPublicKeyLoader {

    private PemPublicKeyLoader() {
    }

    public static RSAPublicKey load(String pem) {
        try {
            String normalized = pem
                    .replace("-----BEGIN PUBLIC KEY-----", "")
                    .replace("-----END PUBLIC KEY-----", "")
                    .replaceAll("\\s", "");
            byte[] decoded = Base64.getDecoder().decode(normalized);
            X509EncodedKeySpec spec = new X509EncodedKeySpec(decoded);
            KeyFactory keyFactory = KeyFactory.getInstance("RSA");
            return (RSAPublicKey) keyFactory.generatePublic(spec);
        } catch (NoSuchAlgorithmException | InvalidKeySpecException ex) {
            throw new JwtAuthenticationException(ResultCode.INTERNAL_ERROR, "Failed to load JWT public key", ex);
        }
    }

    public static RSAPublicKey loadFromPath(String path) {
        try {
            String pem = Files.readString(Path.of(path), StandardCharsets.UTF_8);
            return load(pem);
        } catch (IOException ex) {
            throw new JwtAuthenticationException(ResultCode.INTERNAL_ERROR, "Cannot read JWT public key: " + path, ex);
        }
    }
}
