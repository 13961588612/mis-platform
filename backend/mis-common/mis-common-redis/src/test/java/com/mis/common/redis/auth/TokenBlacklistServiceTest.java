package com.mis.common.redis.auth;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class TokenBlacklistServiceTest {

    @Mock
    private StringRedisTemplate redisTemplate;

    @Mock
    private ValueOperations<String, String> valueOperations;

    @InjectMocks
    private TokenBlacklistService tokenBlacklistService;

    @Test
    void blacklistWritesKeyWithTtl() {
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        tokenBlacklistService.blacklist("jti-1", Duration.ofSeconds(60));
        verify(valueOperations).set(eq("mis:auth:token:blacklist:jti-1"), eq("1"), eq(Duration.ofSeconds(60)));
    }

    @Test
    void isBlacklistedReadsRedis() {
        when(redisTemplate.hasKey("mis:auth:token:blacklist:jti-2")).thenReturn(true);
        assertThat(tokenBlacklistService.isBlacklisted("jti-2")).isTrue();
    }

    @Test
    void ignoresBlankJti() {
        assertThat(tokenBlacklistService.isBlacklisted("")).isFalse();
        assertThat(tokenBlacklistService.isBlacklisted(null)).isFalse();
    }
}
