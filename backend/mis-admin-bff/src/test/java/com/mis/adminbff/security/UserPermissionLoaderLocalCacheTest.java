package com.mis.adminbff.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.adminbff.client.IamWebClient;
import com.mis.common.security.context.LoginUser;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link UserPermissionLoader} 本地短 TTL 缓存的惊群防护行为测试（T2，2026-08-12）。
 *
 * <p><b>固化的风险（C-2 遗留，2026-08-10 记录）：</b>C-2 把 Redis 故障从「500」
 * 降级成「缓存 miss 回源」，但 Redis 整体宕机时<b>每个请求</b>都会回源 mis-iam——
 * 权限查询惊群穿透下游。T2 增加本地短 TTL 缓存（默认 3s，零依赖
 * {@code ConcurrentHashMap} + 时间戳）承接故障期重复查询。
 *
 * <p>本测试锁住的契约：
 * <ul>
 *   <li><b>Redis 故障期</b>连续调用只回源一次/有限次（TTL 窗口内吃本地快照）；</li>
 *   <li><b>TTL 过期后</b>重新回源（快照不会永久陈旧）；</li>
 *   <li><b>Redis 健康时</b>本地缓存完全不参与——缓存 miss 每次都回源（权限变更
 *       经主动 DEL 立即可见，秒级 TTL 不得破坏正常期及时性）。</li>
 * </ul>
 *
 * <p>不沿用既有 {@code UserPermissionLoaderTest} 的 {@code @InjectMocks} 装配：
 * 本测试需要收紧 {@code localTtlMillis}（默认 3s 无法在单测里等它过期），
 * 因此直接 new 被测对象并改包级可见的 TTL 字段。
 */
class UserPermissionLoaderLocalCacheTest {

    private static final long TENANT_ID = 1L;
    private static final long APP_ID = 2L;
    private static final long USER_ID = 10L;

    private static LoginUser loginUser() {
        LoginUser user = new LoginUser();
        user.setUserId(USER_ID);
        user.setTenantId(TENANT_ID);
        user.setAppId(APP_ID);
        user.setUsername("tester");
        return user;
    }

    /** 让 {@code opsForValue().get(key)} 抛出模拟的 Redis 故障。 */
    private static void givenRedisDown(StringRedisTemplate redisTemplate, ValueOperations<String, String> ops) {
        when(redisTemplate.opsForValue()).thenReturn(ops);
        when(ops.get(anyString()))
                .thenThrow(new RedisConnectionFailureException("simulated down"));
    }

    private static UserPermissionLoader newLoader(
            StringRedisTemplate redisTemplate, ObjectMapper mapper, IamWebClient client) {
        UserPermissionLoader loader = new UserPermissionLoader(redisTemplate, mapper, client);
        // 收紧 TTL：单测不等待真实 3 秒
        loader.localTtlMillis = 50L;
        return loader;
    }

    @Nested
    @DisplayName("Redis 故障期：本地短 TTL 承接重复查询")
    class RedisFailureAntiHerd {

        @Test
        @DisplayName("故障期同一用户连续 3 次 load → 只回源一次（其余吃本地快照）")
        void consecutiveCallsHitLocalCache() {
            StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
            ValueOperations<String, String> ops = mock(ValueOperations.class);
            IamWebClient iamWebClient = mock(IamWebClient.class);
            givenRedisDown(redisTemplate, ops);
            when(iamWebClient.loadPermissions(USER_ID)).thenReturn(List.of("p1", "p2"));
            UserPermissionLoader loader = newLoader(redisTemplate, mock(ObjectMapper.class), iamWebClient);

            Set<String> first = loader.load(loginUser());
            Set<String> second = loader.load(loginUser());
            Set<String> third = loader.load(loginUser());

            assertEquals(Set.of("p1", "p2"), first);
            assertEquals(Set.of("p1", "p2"), second);
            assertEquals(Set.of("p1", "p2"), third);
            verify(iamWebClient, times(1)).loadPermissions(USER_ID);
        }

        @Test
        @DisplayName("故障期不同用户各自独立缓存 → 各回源一次（不串数据）")
        void differentUsersHaveSeparateEntries() {
            StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
            ValueOperations<String, String> ops = mock(ValueOperations.class);
            IamWebClient iamWebClient = mock(IamWebClient.class);
            givenRedisDown(redisTemplate, ops);
            when(iamWebClient.loadPermissions(USER_ID)).thenReturn(List.of("p1"));
            when(iamWebClient.loadPermissions(99L)).thenReturn(List.of("q1"));
            UserPermissionLoader loader = newLoader(redisTemplate, mock(ObjectMapper.class), iamWebClient);

            LoginUser userA = loginUser();
            LoginUser userB = loginUser();
            userB.setUserId(99L);

            loader.load(userA);
            loader.load(userB);
            loader.load(userA);
            loader.load(userB);

            verify(iamWebClient, times(1)).loadPermissions(USER_ID);
            verify(iamWebClient, times(1)).loadPermissions(99L);
        }

        @Test
        @DisplayName("TTL 过期后重新回源（快照不永久陈旧）")
        void expiredEntryRefetchesFromSource() throws InterruptedException {
            StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
            ValueOperations<String, String> ops = mock(ValueOperations.class);
            IamWebClient iamWebClient = mock(IamWebClient.class);
            givenRedisDown(redisTemplate, ops);
            when(iamWebClient.loadPermissions(USER_ID)).thenReturn(List.of("p1"));
            UserPermissionLoader loader = newLoader(redisTemplate, mock(ObjectMapper.class), iamWebClient);

            loader.load(loginUser());
            // 等 TTL（50ms）过期后再查一次
            Thread.sleep(120L);
            loader.load(loginUser());

            verify(iamWebClient, times(2)).loadPermissions(USER_ID);
        }
    }

    @Nested
    @DisplayName("Redis 健康期：本地缓存不参与（及时性不被破坏）")
    class RedisHealthyNoLocalParticipation {

        @Test
        @DisplayName("Redis 正常 miss → 每次都回源（不写/不读本地缓存，权限变更立即可见）")
        void healthyMissAlwaysFallsBackToSource() {
            StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
            ValueOperations<String, String> ops = mock(ValueOperations.class);
            IamWebClient iamWebClient = mock(IamWebClient.class);
            // Redis 健康但 key 不存在（普通 miss）
            when(redisTemplate.opsForValue()).thenReturn(ops);
            when(ops.get(anyString())).thenReturn(null);
            when(iamWebClient.loadPermissions(USER_ID)).thenReturn(List.of("p1"));
            UserPermissionLoader loader = newLoader(redisTemplate, mock(ObjectMapper.class), iamWebClient);

            loader.load(loginUser());
            loader.load(loginUser());

            verify(iamWebClient, times(2)).loadPermissions(USER_ID);
        }

        @Test
        @DisplayName("Redis 健康命中 → 直接返回缓存，不回源、不触碰本地缓存")
        void healthyHitReturnsRedisValue() throws Exception {
            StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
            ValueOperations<String, String> ops = mock(ValueOperations.class);
            ObjectMapper mapper = mock(ObjectMapper.class);
            IamWebClient iamWebClient = mock(IamWebClient.class);
            when(redisTemplate.opsForValue()).thenReturn(ops);
            when(ops.get(anyString())).thenReturn("[\"a\",\"b\"]");
            when(mapper.readValue(anyString(),
                    org.mockito.ArgumentMatchers.<com.fasterxml.jackson.core.type.TypeReference<List<String>>>any()))
                    .thenReturn(List.of("a", "b"));
            UserPermissionLoader loader = newLoader(redisTemplate, mapper, iamWebClient);

            Set<String> result = loader.load(loginUser());

            assertEquals(Set.of("a", "b"), result);
            verify(iamWebClient, times(0)).loadPermissions(USER_ID);
        }
    }
}
