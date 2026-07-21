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

    private Set<String> readRedis(long tenantId, long appId, long userId) {
        String json = redisTemplate.opsForValue()
                .get(CacheConstants.RBAC_PERMISSIONS.formatted(tenantId, appId, userId));
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
