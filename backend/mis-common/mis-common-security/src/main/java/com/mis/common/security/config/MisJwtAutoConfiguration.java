package com.mis.common.security.config;

import com.mis.common.security.jwt.JwtIssuer;
import com.mis.common.security.jwt.JwtIssuerFactory;
import com.mis.common.security.jwt.JwtProperties;
import com.mis.common.security.jwt.JwtVerifier;
import com.mis.common.security.jwt.JwtVerifierFactory;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;

/**
 * JWT 相关 Bean 的条件装配。
 * <p>
 * <ul>
 *   <li>{@link JwtVerifier}：配置了公钥时注册（Gateway、mis-auth logout）</li>
 *   <li>{@link JwtIssuer}：配置了私钥时注册（仅 mis-auth）</li>
 * </ul>
 * 未配置对应密钥时不创建 Bean，避免误启动。
 */
@AutoConfiguration
@EnableConfigurationProperties(JwtProperties.class)
public class MisJwtAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean(JwtVerifier.class)
    @ConditionalOnExpression("'${mis.security.jwt.public-key-pem:}' != '' or '${mis.security.jwt.public-key-path:}' != ''")
    public JwtVerifier jwtVerifier(JwtProperties jwtProperties) {
        return JwtVerifierFactory.create(jwtProperties);
    }

    @Bean
    @ConditionalOnMissingBean(JwtIssuer.class)
    @ConditionalOnExpression("'${mis.security.jwt.private-key-pem:}' != '' or '${mis.security.jwt.private-key-path:}' != ''")
    public JwtIssuer jwtIssuer(JwtProperties jwtProperties) {
        return JwtIssuerFactory.create(jwtProperties);
    }
}
