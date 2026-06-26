package com.mis.gateway.config;

import com.mis.common.security.jwt.JwtProperties;
import com.mis.common.security.jwt.JwtVerifier;
import com.mis.common.security.jwt.NoOpTokenBlacklistChecker;
import com.mis.common.security.jwt.PemPublicKeyLoader;
import com.mis.common.security.jwt.RsaJwtVerifier;
import com.mis.common.security.jwt.TokenBlacklistChecker;
import com.mis.gateway.filter.JwtAuthenticationGlobalFilter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.util.StringUtils;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * Gateway 安全相关 Bean 装配。
 * <p>
 * <ul>
 *   <li>{@link JwtVerifier}：仅当配置了 JWT 公钥时启用；无私钥时整个 L1 过滤器不注册</li>
 *   <li>{@link TokenBlacklistChecker}：若 classpath 存在 Redis 且已装配
 *       {@link com.mis.common.redis.auth.RedisTokenBlacklistChecker} 则用之；否则回退 {@link NoOpTokenBlacklistChecker}</li>
 *   <li>{@link JwtAuthenticationGlobalFilter}：注册为 GlobalFilter</li>
 * </ul>
 * 公钥与 mis-auth 私钥配对；remote 模式公钥路径见 Nacos `mis-common` 配置。
 */
@Configuration
@EnableConfigurationProperties({JwtProperties.class, GatewaySecurityProperties.class})
@ConditionalOnProperty(prefix = "mis.security.gateway", name = "enabled", havingValue = "true", matchIfMissing = true)
@ConditionalOnExpression("'${mis.security.jwt.public-key-pem:}' != '' or '${mis.security.jwt.public-key-path:}' != ''")
public class GatewaySecurityConfiguration {

    @Bean
    public JwtVerifier jwtVerifier(JwtProperties jwtProperties, ResourceLoader resourceLoader) throws IOException {
        if (StringUtils.hasText(jwtProperties.getPublicKeyPem())) {
            return new RsaJwtVerifier(PemPublicKeyLoader.load(jwtProperties.getPublicKeyPem()));
        }
        String path = jwtProperties.getPublicKeyPath();
        Resource resource = resourceLoader.getResource(path);
        String pem = resource.getContentAsString(StandardCharsets.UTF_8);
        return new RsaJwtVerifier(PemPublicKeyLoader.load(pem));
    }

    /**
     * 无 Redis 时的兜底；有 {@code mis-common-redis} 时由 {@code MisRedisAutoConfiguration} 优先注册 Redis 实现。
     */
    @Bean
    @ConditionalOnMissingBean(TokenBlacklistChecker.class)
    public TokenBlacklistChecker tokenBlacklistChecker() {
        return new NoOpTokenBlacklistChecker();
    }

    @Bean
    public JwtAuthenticationGlobalFilter jwtAuthenticationGlobalFilter(
            JwtVerifier jwtVerifier,
            TokenBlacklistChecker tokenBlacklistChecker,
            GatewaySecurityProperties gatewaySecurityProperties,
            com.fasterxml.jackson.databind.ObjectMapper objectMapper) {
        return new JwtAuthenticationGlobalFilter(
                jwtVerifier, tokenBlacklistChecker, gatewaySecurityProperties, objectMapper);
    }
}
