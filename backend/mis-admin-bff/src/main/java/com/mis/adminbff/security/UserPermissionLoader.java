package com.mis.adminbff.security;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.adminbff.client.IamWebClient;
import com.mis.common.core.constant.CacheConstants;
import com.mis.common.security.context.LoginUser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 从 Redis 读 permissions；miss 时回源 mis-iam 并写缓存（ADR-009）。
 *
 * <p><b>C-2 惊群防护（2026-08-12 立项）：</b>Redis 整体宕机时 {@link #readRedis}
 * 返回 {@code null}（降级=缓存 miss），于是每个请求都回源 mis-iam——权限查询在
 * Redis 故障期会<b>惊群穿透</b>下游。这里加一层<b>本地短 TTL 缓存</b>
 * （{@link ConcurrentHashMap} + 时间戳，零依赖，默认 3 秒）承接故障期的重复查询：
 * 同一用户 3 秒窗口内只回源一次，其余请求直接吃本地快照。
 *
 * <p><b>只在 Redis 故障期生效</b>（{@link #readRedis} 判定 redisDown 才读写本地缓存）：
 * Redis 健康时权限变更经主动 DEL 立即可见，本地缓存完全不参与，因此秒级 TTL
 * <b>不会</b>破坏权限变更的及时性；Redis 故障期最坏延迟也仅 3 秒（TTL 窗口），
 * 是可接受的明确取舍（与「Redis 挂 = 缓存 miss 回源」的 C-2 降级语义兼容：
 * 本地缓存过期后仍回落回源兜底）。
 */
@Component
public class UserPermissionLoader {

    private static final Logger log = LoggerFactory.getLogger(UserPermissionLoader.class);
    private static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() {};

    /**
     * 本地缓存默认 TTL（毫秒）。包级可见仅供单测缩短后验证过期重回源，生产不调整。
     */
    static final long DEFAULT_LOCAL_TTL_MILLIS = 3_000L;

    /** 本地缓存最大条目数；超限时不再写入（防 Redis 长时间故障撑爆堆外内存）。 */
    private static final int LOCAL_CACHE_MAX_ENTRIES = 8192;

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;
    private final IamWebClient iamWebClient;

    /** 本地短 TTL 缓存：key = Redis 同款权限 key，value = 快照 + 过期时间戳。 */
    private final Map<String, LocalEntry> localCache = new ConcurrentHashMap<>();

    /** TTL（毫秒），单测可缩短。 */
    volatile long localTtlMillis = DEFAULT_LOCAL_TTL_MILLIS;

    public UserPermissionLoader(
            StringRedisTemplate redisTemplate,
            ObjectMapper objectMapper,
            IamWebClient iamWebClient) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
        this.iamWebClient = iamWebClient;
    }

    public Set<String> load(LoginUser user) {
        if (user == null || user.getUserId() == null
                || user.getTenantId() == null || user.getAppId() == null) {
            return Set.of();
        }
        if (user.getPermissions() != null && !user.getPermissions().isEmpty()) {
            return user.getPermissions();
        }
        String cacheKey = CacheConstants.RBAC_PERMISSIONS.formatted(
                user.getTenantId(), user.getAppId(), user.getUserId());
        RedisRead read = readRedis(user.getTenantId(), user.getAppId(), user.getUserId());
        if (read.available()) {
            return read.permissions();
        }
        if (read.redisDown()) {
            // Redis 故障期惊群防护：先吃本地短 TTL 快照（fresh 才有效）
            Set<String> local = readLocal(cacheKey);
            if (local != null) {
                return local;
            }
        }
        try {
            List<String> permissions = iamWebClient.loadPermissions(user.getUserId());
            Set<String> result = permissions == null ? Set.of() : new LinkedHashSet<>(permissions);
            if (read.redisDown()) {
                writeLocal(cacheKey, result);
            }
            return result;
        } catch (Exception ex) {
            log.warn("回源加载 permissions 失败: userId={}", user.getUserId(), ex);
            return Set.of();
        }
    }

    /**
     * 读取权限缓存。返回 {@code null} 表示「不可用」——调用方 {@link #load(LoginUser)}
     * 会据此落入回源分支（ADR-009：miss 时回源）。
     *
     * <p><b>C-2 修复点（别把 try-catch 去掉）</b>：这里的 Redis 访问原先是裸调用。
     * 连接故障 / 读超时抛出的 {@code RedisConnectionFailureException}、
     * {@code QueryTimeoutException} 等都是 {@link RuntimeException}，会直接冒泡出
     * {@code load()}——注意 {@code load()} 只在<b>回源</b>那一段有 try-catch，
     * 缓存读取这一段的调用点是裸的，于是整条鉴权链路 500。
     *
     * <p>把「Redis 挂了」降级成「缓存 miss」是这里唯一正确的语义：权限的权威源是
     * mis-iam，缓存只是加速层，加速层不可用不该让请求失败。
     *
     * <p>catch 的是 {@code Exception} 而非 {@code DataAccessException}：Lettuce 的部分
     * 底层异常（如 {@code RedisCommandTimeoutException}）未必都能被 Spring 的异常转换器
     * 翻译成 {@code DataAccessException}，收窄捕获范围等于给 500 留后门。
     * 与下方回源分支 catch {@code Exception} 的口径保持一致。
     *
     * @return {@link RedisRead}：{@code available()=true} 表示拿到缓存值；
     *         {@code redisDown()=true} 表示 Redis 不可用（区别于普通 miss，供惊群防护分支判断）
     */
    private RedisRead readRedis(long tenantId, long appId, long userId) {
        String json;
        try {
            json = redisTemplate.opsForValue()
                    .get(CacheConstants.RBAC_PERMISSIONS.formatted(tenantId, appId, userId));
        } catch (Exception ex) {
            log.warn("读取 permissions 缓存失败，降级为回源: tenantId={}, appId={}, userId={}",
                    tenantId, appId, userId, ex);
            return RedisRead.down();
        }
        if (json == null || json.isBlank()) {
            return RedisRead.miss();
        }
        try {
            List<String> list = objectMapper.readValue(json, STRING_LIST);
            Set<String> permissions = list == null
                    ? Collections.emptySet()
                    : new LinkedHashSet<>(list);
            return RedisRead.hit(permissions);
        } catch (JsonProcessingException ex) {
            log.warn("反序列化 permissions 失败: userId={}", userId, ex);
            return RedisRead.miss();
        }
    }

    /** 读本地短 TTL 快照；无条目或已过期返回 {@code null}。 */
    private Set<String> readLocal(String cacheKey) {
        LocalEntry entry = localCache.get(cacheKey);
        if (entry == null || !entry.freshAt(System.currentTimeMillis())) {
            return null;
        }
        return entry.permissions();
    }

    /** 写本地短 TTL 快照；超容量上限时跳过（防内存失控）。 */
    private void writeLocal(String cacheKey, Set<String> permissions) {
        if (localCache.size() >= LOCAL_CACHE_MAX_ENTRIES && !localCache.containsKey(cacheKey)) {
            log.warn("本地权限缓存已达上限 {}，跳过写入 cacheKey={}", LOCAL_CACHE_MAX_ENTRIES, cacheKey);
            return;
        }
        localCache.put(cacheKey,
                new LocalEntry(permissions, System.currentTimeMillis() + localTtlMillis));
    }

    /**
     * Redis 读取结果。三态：
     * <ul>
     *   <li>{@link #hit(Set)} —— Redis 健康且命中（含缓存空集合）；</li>
     *   <li>{@link #miss()} —— Redis 健康但无缓存值（普通 miss，走回源）；</li>
     *   <li>{@link #down()} —— Redis 不可用（异常），调用方据此启用本地快照承接。</li>
     * </ul>
     */
    private record RedisRead(Set<String> permissions, boolean redisDown) {
        static RedisRead hit(Set<String> permissions) {
            return new RedisRead(permissions, false);
        }

        static RedisRead miss() {
            return new RedisRead(null, false);
        }

        static RedisRead down() {
            return new RedisRead(null, true);
        }

        boolean available() {
            return permissions != null;
        }
    }

    /** 本地缓存条目：权限快照 + 过期时间戳（毫秒）。 */
    private record LocalEntry(Set<String> permissions, long expiresAtMillis) {
        boolean freshAt(long nowMillis) {
            return nowMillis < expiresAtMillis;
        }
    }
}
