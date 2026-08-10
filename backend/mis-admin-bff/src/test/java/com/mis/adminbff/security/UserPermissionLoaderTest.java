package com.mis.adminbff.security;

import com.fasterxml.jackson.core.JsonParseException;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.adminbff.client.IamWebClient;
import com.mis.common.core.constant.CacheConstants;
import com.mis.common.security.context.LoginUser;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentMatchers;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * {@link UserPermissionLoader} 的降级行为测试（C-2 回归）。
 *
 * <p><b>固化的缺陷</b>：{@code readRedis()} 里的 {@code redisTemplate.opsForValue().get(...)}
 * 原先是裸调用。Redis 连接故障 / 读超时抛出的 {@link RedisConnectionFailureException}
 * 属于 {@link RuntimeException}，会穿过 {@code load()} 的缓存读取调用点（那一行没有
 * try-catch，只有下面的回源分支有）直接冒泡，把整条鉴权链路打成 500。
 *
 * <p><b>本测试锁住的契约</b>：缓存层不可用 ≠ 请求失败。权限的权威源是 mis-iam，
 * Redis 只是加速层，所以「Redis 挂了」必须降级成「缓存 miss」并回源，
 * 而回源也失败时才退回空权限集（由 {@code load()} 已有的 catch 兜底）。
 *
 * <p><b>为什么断言口径要带 verify</b>：只断言「没抛异常」是不够的——如果有人把
 * catch 写成吞掉异常后 {@code return Collections.emptySet()}，异常断言照样通过，
 * 但用户会拿到一个「合法的空权限集」，表现为登录后所有菜单消失、且没有任何回源尝试。
 * 那是比 500 更难查的故障。因此降级用例一律追加
 * {@code verify(iamWebClient).loadPermissions(...)}，证明确实走了回源而不是静默吞掉。
 */
@ExtendWith(MockitoExtension.class)
class UserPermissionLoaderTest {

    private static final long TENANT_ID = 1L;
    private static final long APP_ID = 2L;
    private static final long USER_ID = 10L;

    /** 与被测代码使用同一常量拼装，顺带锁住 key 的参数顺序（tenantId:appId:userId）。 */
    private static final String CACHE_KEY =
            CacheConstants.RBAC_PERMISSIONS.formatted(TENANT_ID, APP_ID, USER_ID);

    @Mock
    private StringRedisTemplate redisTemplate;

    @Mock
    private ValueOperations<String, String> valueOperations;

    @Mock
    private ObjectMapper objectMapper;

    @Mock
    private IamWebClient iamWebClient;

    @InjectMocks
    private UserPermissionLoader loader;

    /**
     * 构造触发 readRedis 分支的登录态。
     *
     * <p>不设置 permissions：{@link LoginUser} 的该字段初值恒为
     * {@code Collections.emptySet()}，{@code load()} 的
     * {@code permissions != null && !permissions.isEmpty()} 短路条件不成立，
     * 于是必然往下走到缓存读取——正是本测试要覆盖的路径。
     */
    private static LoginUser loginUser() {
        LoginUser user = new LoginUser();
        user.setUserId(USER_ID);
        user.setTenantId(TENANT_ID);
        user.setAppId(APP_ID);
        user.setUsername("tester");
        return user;
    }

    /** 让 {@code opsForValue().get(key)} 抛出模拟的 Redis 故障。 */
    private void givenRedisDown() {
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.get(anyString()))
                .thenThrow(new RedisConnectionFailureException("simulated down"));
    }

    /** 让 {@code opsForValue().get(key)} 返回指定内容。 */
    private void givenRedisReturns(String json) {
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.get(CACHE_KEY)).thenReturn(json);
    }

    // ------------------------------------------------------------ C-2 核心：Redis 故障不得 500

    @Nested
    @DisplayName("C-2：Redis 故障时的降级")
    class RedisFailure {

        @Test
        @DisplayName("Redis 抛连接异常 → 不冒泡，降级回源并返回回源结果")
        void redisDown_degradesToSource() {
            givenRedisDown();
            when(iamWebClient.loadPermissions(USER_ID)).thenReturn(List.of("p1", "p2"));

            Set<String> result = assertDoesNotThrow(() -> loader.load(loginUser()),
                    "Redis 故障必须被 readRedis 内部消化，绝不能冒泡出 load() 造成 500");

            assertEquals(Set.of("p1", "p2"), result);
            // 关键：证明是「降级为缓存 miss 后回源」，而不是把异常吞成空集
            verify(iamWebClient).loadPermissions(USER_ID);
        }

        @Test
        @DisplayName("Redis 故障 + 回源也失败 → 返回空集兜底，仍不抛异常")
        void redisDown_andSourceAlsoFails_returnsEmpty() {
            givenRedisDown();
            when(iamWebClient.loadPermissions(USER_ID))
                    .thenThrow(new IllegalStateException("iam unreachable"));

            Set<String> result = assertDoesNotThrow(() -> loader.load(loginUser()),
                    "两级都挂时应由 load() 已有的 catch 兜底为空集，而不是把异常抛给上层");

            assertEquals(Set.of(), result);
            assertTrue(result.isEmpty());
            verify(iamWebClient).loadPermissions(USER_ID);
        }

        @Test
        @DisplayName("opsForValue() 本身抛异常（连接池耗尽）→ 同样降级回源")
        void opsForValueThrows_degradesToSource() {
            // 故障不一定发生在 get()，拿连接的那一步也可能炸；try 块必须把两者都罩住
            when(redisTemplate.opsForValue())
                    .thenThrow(new RedisConnectionFailureException("pool exhausted"));
            when(iamWebClient.loadPermissions(USER_ID)).thenReturn(List.of("p1"));

            Set<String> result = assertDoesNotThrow(() -> loader.load(loginUser()));

            assertEquals(Set.of("p1"), result);
            verify(iamWebClient).loadPermissions(USER_ID);
        }
    }

    // ------------------------------------------------------------ 正常路径不得被修复破坏

    @Nested
    @DisplayName("缓存正常路径")
    class CacheHappyPath {

        @Test
        @DisplayName("缓存命中 → 直接返回缓存内容，不回源")
        void cacheHit_returnsCached() throws Exception {
            String json = "[\"a\",\"b\"]";
            givenRedisReturns(json);
            when(objectMapper.readValue(eq(json), ArgumentMatchers.<TypeReference<List<String>>>any()))
                    .thenReturn(List.of("a", "b"));

            Set<String> result = loader.load(loginUser());

            assertEquals(Set.of("a", "b"), result);
            // 命中还回源就失去了缓存的意义
            verifyNoInteractions(iamWebClient);
        }

        @Test
        @DisplayName("缓存 miss（null）→ 回源")
        void cacheMiss_fallsBackToSource() {
            givenRedisReturns(null);
            when(iamWebClient.loadPermissions(USER_ID)).thenReturn(List.of("p1"));

            assertEquals(Set.of("p1"), loader.load(loginUser()));
            verify(iamWebClient).loadPermissions(USER_ID);
        }

        @Test
        @DisplayName("反序列化失败 → 降级回源（脏缓存不得让请求失败）")
        void deserializeFail_fallsBackToSource() throws Exception {
            String json = "{not-a-json-array";
            givenRedisReturns(json);
            when(objectMapper.readValue(eq(json), ArgumentMatchers.<TypeReference<List<String>>>any()))
                    .thenThrow(new JsonParseException((JsonParser) null, "simulated invalid json"));
            when(iamWebClient.loadPermissions(USER_ID)).thenReturn(List.of("p1", "p2"));

            Set<String> result = assertDoesNotThrow(() -> loader.load(loginUser()));

            assertEquals(Set.of("p1", "p2"), result);
            verify(iamWebClient).loadPermissions(USER_ID);
        }
    }

    // ------------------------------------------------------------ 短路分支（防修复时误伤）

    @Nested
    @DisplayName("短路分支")
    class ShortCircuit {

        @Test
        @DisplayName("user 自带 permissions → 既不读 Redis 也不回源")
        void userWithPermissions_skipsEverything() {
            LoginUser user = loginUser();
            user.setPermissions(Set.of("own:perm"));

            assertEquals(Set.of("own:perm"), loader.load(user));

            verifyNoInteractions(redisTemplate);
            verifyNoInteractions(iamWebClient);
        }

        @Test
        @DisplayName("user 为 null → 返回空集，不触达任何协作者")
        void nullUser_returnsEmpty() {
            assertEquals(Set.of(), loader.load(null));

            verifyNoInteractions(redisTemplate);
            verifyNoInteractions(iamWebClient);
        }

        @Test
        @DisplayName("userId 为空 → 返回空集，不白跑一次 Redis / 回源")
        void nullUserId_returnsEmpty() {
            LoginUser user = loginUser();
            user.setUserId(null);

            assertEquals(Set.of(), loader.load(user));

            verifyNoInteractions(redisTemplate);
            verify(iamWebClient, never()).loadPermissions(anyLong());
        }
    }
}
