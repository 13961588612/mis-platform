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
import java.util.Set;

/**
 * 从 Redis 读 permissions；miss 时回源 mis-iam 并写缓存（ADR-009）。
 */
@Component
public class UserPermissionLoader {

    private static final Logger log = LoggerFactory.getLogger(UserPermissionLoader.class);
    private static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() {};

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;
    private final IamWebClient iamWebClient;

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
        Set<String> cached = readRedis(user.getTenantId(), user.getAppId(), user.getUserId());
        if (cached != null) {
            return cached;
        }
        try {
            List<String> permissions = iamWebClient.loadPermissions(user.getUserId());
            return permissions == null ? Set.of() : new LinkedHashSet<>(permissions);
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
     */
    private Set<String> readRedis(long tenantId, long appId, long userId) {
        String json;
        try {
            json = redisTemplate.opsForValue()
                    .get(CacheConstants.RBAC_PERMISSIONS.formatted(tenantId, appId, userId));
        } catch (Exception ex) {
            log.warn("读取 permissions 缓存失败，降级为回源: tenantId={}, appId={}, userId={}",
                    tenantId, appId, userId, ex);
            return null;
        }
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            List<String> list = objectMapper.readValue(json, STRING_LIST);
            return list == null ? Collections.emptySet() : new LinkedHashSet<>(list);
        } catch (JsonProcessingException ex) {
            log.warn("反序列化 permissions 失败: userId={}", userId, ex);
            return null;
        }
    }
}
