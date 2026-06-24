package com.mis.common.security.jwt;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.core.io.Resource;

/**
 * JWT 密钥配置（Gateway 公钥 / mis-auth 私钥）。
 */
@ConfigurationProperties(prefix = "mis.security.jwt")
public class JwtProperties {

    /**
     * PEM 公钥文件路径（filesystem 或 classpath:...）。
     */
    private String publicKeyPath;

    /**
     * 内联 PEM 公钥（优先级高于 publicKeyPath，便于测试）。
     */
    private String publicKeyPem;

    /**
     * Spring Resource 形式（Gateway 自动配置可选使用）。
     */
    private Resource publicKeyResource;

    /**
     * PEM 私钥文件路径（仅 mis-auth 签发使用）。
     */
    private String privateKeyPath;

    /**
     * 内联 PEM 私钥。
     */
    private String privateKeyPem;

    /**
     * Spring Resource 形式私钥。
     */
    private Resource privateKeyResource;

    /**
     * Access Token 有效期（秒），默认 7200。
     */
    private long accessTokenTtlSeconds = 7200;

    /**
     * Refresh Token 有效期（秒），默认 604800（7 天）。
     */
    private long refreshTokenTtlSeconds = 604800;

    public String getPublicKeyPath() {
        return publicKeyPath;
    }

    public void setPublicKeyPath(String publicKeyPath) {
        this.publicKeyPath = publicKeyPath;
    }

    public String getPublicKeyPem() {
        return publicKeyPem;
    }

    public void setPublicKeyPem(String publicKeyPem) {
        this.publicKeyPem = publicKeyPem;
    }

    public Resource getPublicKeyResource() {
        return publicKeyResource;
    }

    public void setPublicKeyResource(Resource publicKeyResource) {
        this.publicKeyResource = publicKeyResource;
    }

    public String getPrivateKeyPath() {
        return privateKeyPath;
    }

    public void setPrivateKeyPath(String privateKeyPath) {
        this.privateKeyPath = privateKeyPath;
    }

    public String getPrivateKeyPem() {
        return privateKeyPem;
    }

    public void setPrivateKeyPem(String privateKeyPem) {
        this.privateKeyPem = privateKeyPem;
    }

    public Resource getPrivateKeyResource() {
        return privateKeyResource;
    }

    public void setPrivateKeyResource(Resource privateKeyResource) {
        this.privateKeyResource = privateKeyResource;
    }

    public long getAccessTokenTtlSeconds() {
        return accessTokenTtlSeconds;
    }

    public void setAccessTokenTtlSeconds(long accessTokenTtlSeconds) {
        this.accessTokenTtlSeconds = accessTokenTtlSeconds;
    }

    public long getRefreshTokenTtlSeconds() {
        return refreshTokenTtlSeconds;
    }

    public void setRefreshTokenTtlSeconds(long refreshTokenTtlSeconds) {
        this.refreshTokenTtlSeconds = refreshTokenTtlSeconds;
    }
}
