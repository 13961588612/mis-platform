package com.mis.common.redis.auth;

import com.mis.common.core.constant.CacheConstants;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Duration;

/**
 * Access Token {@code jti} 黑名单读写（ADR-002 登出 / ADR-006 缓存策略）。
 * <p>
 * <ul>
 *   <li><b>写</b>：{@code mis-auth} 登出时调用 {@link #blacklist(String, Duration)}</li>
 *   <li><b>读</b>：{@code mis-gateway} 验签后通过 {@link RedisTokenBlacklistChecker} 调用 {@link #isBlacklisted(String)}</li>
 * </ul>
 * Redis Key：{@link CacheConstants#AUTH_TOKEN_BLACKLIST}，TTL 建议为 Access Token 剩余有效期，
 * 过期后 key 自动删除，无需长期占用内存。
 */
public class TokenBlacklistService {

    private final StringRedisTemplate redisTemplate;

    public TokenBlacklistService(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /**
     * 将 jti 标记为已吊销；空 jti 或非法 TTL 时静默跳过。
     */
    public void blacklist(String jti, Duration ttl) {
        if (jti == null || jti.isBlank() || ttl == null || ttl.isZero() || ttl.isNegative()) {
            return;
        }
        String key = CacheConstants.AUTH_TOKEN_BLACKLIST.formatted(jti);
        redisTemplate.opsForValue().set(key, "1", ttl);
    }

    /**
     * @return true 表示该 jti 在黑名单中，Gateway 应返回 401
     */
    public boolean isBlacklisted(String jti) {
        if (jti == null || jti.isBlank()) {
            return false;
        }
        String key = CacheConstants.AUTH_TOKEN_BLACKLIST.formatted(jti);
        return Boolean.TRUE.equals(redisTemplate.hasKey(key));
    }
}
