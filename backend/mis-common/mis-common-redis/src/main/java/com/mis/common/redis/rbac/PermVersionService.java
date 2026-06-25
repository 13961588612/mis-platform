package com.mis.common.redis.rbac;

import com.mis.common.core.constant.CacheConstants;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.function.LongSupplier;

/**
 * 权限版本号：权威源为 PostgreSQL {@code sys_user.perm_version}，Redis 为缓存（ADR-009）。
 * <p>
 * 陈旧判定：{@link #isStale(long, long)} 为 {@code jwtVersion != currentVersion}（非小于比较）。
 */
public class PermVersionService {

    private final StringRedisTemplate redisTemplate;

    public PermVersionService(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /**
     * 登录/刷新签发 JWT 前：以 DB 为准写回 Redis，修复断电后版本回退。
     */
    public long syncCacheFromAuthority(long tenantId, long appId, long userId, long dbVersion) {
        long version = dbVersion > 0 ? dbVersion : 1L;
        redisTemplate.opsForValue().set(versionKey(tenantId, appId, userId), String.valueOf(version));
        return version;
    }

    /**
     * BFF 读取当前版本：Redis 命中直接返回；miss 时 {@code dbFallback} 回源并回填。
     */
    public long getCurrentVersion(long tenantId, long appId, long userId, LongSupplier dbFallback) {
        String key = versionKey(tenantId, appId, userId);
        String cached = redisTemplate.opsForValue().get(key);
        if (cached != null && !cached.isBlank()) {
            return Long.parseLong(cached.trim());
        }
        long dbVersion = dbFallback.getAsLong();
        long version = dbVersion > 0 ? dbVersion : 1L;
        redisTemplate.opsForValue().set(key, String.valueOf(version));
        return version;
    }

    /**
     * mis-rbac 权限变更后：DB 已 INCR，将新版本写入 Redis（与 DB 保持一致）。
     */
    public void writeVersion(long tenantId, long appId, long userId, long version) {
        redisTemplate.opsForValue().set(versionKey(tenantId, appId, userId), String.valueOf(version));
    }

    public static boolean isStale(long jwtPermVersion, long currentPermVersion) {
        return jwtPermVersion != currentPermVersion;
    }

    private static String versionKey(long tenantId, long appId, long userId) {
        return CacheConstants.RBAC_PERM_VERSION.formatted(tenantId, appId, userId);
    }
}
