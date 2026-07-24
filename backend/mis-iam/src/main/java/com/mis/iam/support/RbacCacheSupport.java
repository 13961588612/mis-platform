package com.mis.iam.support;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.common.core.constant.CacheConstants;
import com.mis.common.redis.rbac.PermVersionService;
import com.mis.iam.config.IamProperties;
import com.mis.iam.domain.entity.SysUser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 权限变更后：写/删 permissions 与 perm_version（ADR-009）。
 */
@Component
public class RbacCacheSupport {

    private static final Logger log = LoggerFactory.getLogger(RbacCacheSupport.class);
    private static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() {};

    private final StringRedisTemplate redisTemplate;
    private final PermVersionService permVersionService;
    private final ObjectMapper objectMapper;
    private final IamProperties iamProperties;

    public RbacCacheSupport(
            StringRedisTemplate redisTemplate,
            PermVersionService permVersionService,
            ObjectMapper objectMapper,
            IamProperties iamProperties) {
        this.redisTemplate = redisTemplate;
        this.permVersionService = permVersionService;
        this.objectMapper = objectMapper;
        this.iamProperties = iamProperties;
    }

    public void onUserPermissionsChanged(SysUser user) {
        long tenantId = user.getTenantId();
        long appId = user.getAppId();
        long userId = user.getId();
        long version = user.getPermVersion() == null ? 1L : user.getPermVersion();
        permVersionService.writeVersion(tenantId, appId, userId, version);
        redisTemplate.delete(CacheConstants.RBAC_PERMISSIONS.formatted(tenantId, appId, userId));
    }

    public void writePermissions(long tenantId, long appId, long userId, Collection<String> permissions) {
        Set<String> unique = permissions == null
                ? Set.of()
                : new LinkedHashSet<>(permissions);
        try {
            String json = objectMapper.writeValueAsString(unique);
            Duration ttl = Duration.ofMinutes(Math.max(iamProperties.getPermissionsTtlMinutes(), 1));
            redisTemplate.opsForValue().set(
                    CacheConstants.RBAC_PERMISSIONS.formatted(tenantId, appId, userId), json, ttl);
        } catch (JsonProcessingException ex) {
            log.warn("序列化 permissions 失败: userId={}", userId, ex);
        }
    }

    public Set<String> readPermissions(long tenantId, long appId, long userId) {
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
