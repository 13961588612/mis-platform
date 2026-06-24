package com.mis.auth.service;

import com.mis.auth.config.AuthProperties;
import com.mis.common.core.constant.CacheConstants;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;

@Service
public class LoginLockService {

    private final StringRedisTemplate redisTemplate;
    private final AuthProperties authProperties;

    public LoginLockService(StringRedisTemplate redisTemplate, AuthProperties authProperties) {
        this.redisTemplate = redisTemplate;
        this.authProperties = authProperties;
    }

    public void checkLocked(Long tenantId, Long appId, String username) {
        String key = failKey(tenantId, appId, username);
        String count = redisTemplate.opsForValue().get(key);
        if (count != null && Integer.parseInt(count) >= authProperties.getMaxLoginFailures()) {
            throw new BusinessException(ResultCode.ACCOUNT_LOCKED);
        }
    }

    public void recordFailure(Long tenantId, Long appId, String username) {
        String key = failKey(tenantId, appId, username);
        Long count = redisTemplate.opsForValue().increment(key);
        if (count != null && count == 1L) {
            redisTemplate.expire(key, Duration.ofSeconds(authProperties.getLoginLockSeconds()));
        }
    }

    public void clearFailures(Long tenantId, Long appId, String username) {
        redisTemplate.delete(failKey(tenantId, appId, username));
    }

    private static String failKey(Long tenantId, Long appId, String username) {
        return CacheConstants.AUTH_LOGIN_FAIL.formatted(tenantId, appId, username);
    }
}
