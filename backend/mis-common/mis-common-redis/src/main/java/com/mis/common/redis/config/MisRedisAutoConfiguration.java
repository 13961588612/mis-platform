package com.mis.common.redis.config;

import com.mis.common.redis.auth.RedisTokenBlacklistChecker;
import com.mis.common.redis.auth.TokenBlacklistService;
import com.mis.common.redis.rbac.PermVersionService;
import com.mis.common.security.jwt.TokenBlacklistChecker;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

/**
 * Redis 公共能力自动配置。
 * <p>
 * 当 classpath 存在 Redis 且 {@link RedisConnectionFactory} 可用时，注册 Token 黑名单实现，
 * 供 mis-gateway / mis-auth 使用。Gateway 侧通过 {@link TokenBlacklistChecker} 接口注入。
 */
@AutoConfiguration
@ConditionalOnClass(StringRedisTemplate.class)
public class MisRedisAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean(StringRedisTemplate.class)
    public StringRedisTemplate stringRedisTemplate(RedisConnectionFactory connectionFactory) {
        return new StringRedisTemplate(connectionFactory);
    }

    @Bean
    @ConditionalOnBean(RedisConnectionFactory.class)
    @ConditionalOnMissingBean(TokenBlacklistService.class)
    public TokenBlacklistService tokenBlacklistService(StringRedisTemplate redisTemplate) {
        return new TokenBlacklistService(redisTemplate);
    }

    @Bean
    @ConditionalOnBean(RedisConnectionFactory.class)
    @ConditionalOnMissingBean(TokenBlacklistChecker.class)
    public TokenBlacklistChecker redisTokenBlacklistChecker(TokenBlacklistService tokenBlacklistService) {
        return new RedisTokenBlacklistChecker(tokenBlacklistService);
    }

    @Bean
    @ConditionalOnBean(StringRedisTemplate.class)
    @ConditionalOnMissingBean(PermVersionService.class)
    public PermVersionService permVersionService(StringRedisTemplate redisTemplate) {
        return new PermVersionService(redisTemplate);
    }
}
