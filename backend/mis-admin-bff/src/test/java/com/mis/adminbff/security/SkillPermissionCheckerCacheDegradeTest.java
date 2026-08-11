package com.mis.adminbff.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.support.AgentOpsErrorCodes;
import com.mis.common.core.exception.BusinessException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.time.Duration;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link SkillPermissionChecker} 的<b>缓存故障降级</b>回归。
 *
 * <p><b>为什么单独立一个测试类</b>：这个缺陷是端到端 curl 验证
 * {@code GET /internal/permissions} 时才暴露的——Redis 不通的本地实例上，
 * 带正确服务凭证的请求返回 {@code HTTP 500 / code=50000 系统错误}。
 * 原因是 {@code readCache} 直接把 {@code RedisConnectionFailureException} 抛了出去，
 * 而 {@code loadPermissions} 只 catch {@code BusinessException}。
 *
 * <p><b>为什么这很严重</b>：ai-platform 侧收到 500 会判「权限源不可用」并
 * fail-closed 拒绝<b>每一次</b>技能执行。也就是说——<b>Redis 抖一下，
 * 即便 mis-iam 完全健康，整个 agent 的工具能力也会全线瘫痪</b>，
 * 表现与本次修复的那个故障一模一样（「权限服务暂不可用」）。
 *
 * <p>正确语义：<b>缓存降级 ≠ 权限源不可用</b>。同模块 {@code UserPermissionLoader}
 * 早已如此实现，Python 侧 TC-13 也明确断言「Redis 挂但 BFF 可达 ⇒ 正常放行」。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("SkillPermissionChecker · 缓存故障降级（不得伪装成权限源不可用）")
class SkillPermissionCheckerCacheDegradeTest {

    private static final Long USER_ID = 1001L;
    private static final String CACHE_KEY = "mis:acl:skillperm:1001";

    @Mock
    private IamWebClient iamWebClient;

    @Mock
    private StringRedisTemplate redisTemplate;

    @Mock
    private ValueOperations<String, String> valueOperations;

    private SkillPermissionChecker checker;

    @BeforeEach
    void setUp() {
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        checker = new SkillPermissionChecker(
                iamWebClient, redisTemplate, new ObjectMapper(), "");
    }

    @Nested
    @DisplayName("Redis 不可用")
    class RedisDown {

        @Test
        @DisplayName("读缓存抛异常 → 降级回源并正常返回，绝不冒泡成 500")
        void readFailureDegradesToSource() {
            when(valueOperations.get(CACHE_KEY))
                    .thenThrow(new RedisConnectionFailureException("simulated down"));
            when(iamWebClient.loadPermissions(USER_ID))
                    .thenReturn(List.of("ai:skill:member.profile:run"));

            Set<String> codes = checker.resolvePermissionCodes(USER_ID);

            assertEquals(Set.of("ai:skill:member.profile:run"), codes,
                    "Redis 挂但 mis-iam 健康时必须照常取到码；"
                            + "抛异常会让 ai-platform 判权限源不可用并拒绝所有技能");
            verify(iamWebClient).loadPermissions(USER_ID);
        }

        @Test
        @DisplayName("写缓存抛异常 → 不影响本次判定结果")
        void writeFailureDoesNotBreakResult() {
            when(valueOperations.get(CACHE_KEY)).thenReturn(null);
            when(iamWebClient.loadPermissions(USER_ID)).thenReturn(List.of("ai:skill:a:run"));
            doThrow(new RedisConnectionFailureException("simulated down"))
                    .when(valueOperations).set(anyString(), anyString(), any(Duration.class));

            Set<String> codes = checker.resolvePermissionCodes(USER_ID);

            assertEquals(Set.of("ai:skill:a:run"), codes,
                    "真值已从权限源取到，写缓存失败只该告警");
        }

        @Test
        @DisplayName("缓存挂 + 权限源也挂 → 仍是 ACL_UNAVAILABLE（fail-closed 不被削弱）")
        void sourceFailureStillFailsClosed() {
            when(valueOperations.get(CACHE_KEY))
                    .thenThrow(new RedisConnectionFailureException("simulated down"));
            when(iamWebClient.loadPermissions(USER_ID))
                    .thenThrow(new BusinessException(50000, "iam down"));

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> checker.resolvePermissionCodes(USER_ID));

            assertEquals(AgentOpsErrorCodes.ACL_UNAVAILABLE, ex.getCode(),
                    "降级只针对缓存层；权限源真挂了必须照旧 fail-closed");
        }
    }

    @Nested
    @DisplayName("缓存正常路径不受影响")
    class CacheHealthy {

        @Test
        @DisplayName("命中缓存 → 直接返回且不回源")
        void cacheHitSkipsSource() {
            when(valueOperations.get(CACHE_KEY)).thenReturn("[\"ai:skill:a:run\"]");

            assertEquals(Set.of("ai:skill:a:run"), checker.resolvePermissionCodes(USER_ID));
            verify(iamWebClient, never()).loadPermissions(anyLong());
        }

        @Test
        @DisplayName("缓存内容损坏 → 视为未命中并回源，不崩溃")
        void corruptedCacheTreatedAsMiss() {
            when(valueOperations.get(CACHE_KEY)).thenReturn("{not-json");
            when(iamWebClient.loadPermissions(USER_ID)).thenReturn(List.of("ai:skill:a:run"));

            assertEquals(Set.of("ai:skill:a:run"), checker.resolvePermissionCodes(USER_ID));
        }

        @Test
        @DisplayName("空集合是合法结果 → 原样返回（由调用方判 contains 后拒绝）")
        void emptySetIsLegal() {
            when(valueOperations.get(CACHE_KEY)).thenReturn(null);
            when(iamWebClient.loadPermissions(USER_ID)).thenReturn(List.of());

            assertTrue(checker.resolvePermissionCodes(USER_ID).isEmpty());
        }
    }
}
