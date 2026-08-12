package com.mis.common.security.permission;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.List;
import java.util.Set;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SEC-01 验收：{@code denyUnmapped} 默认 fail-closed + 拦截器行为断言。
 *
 * <p>覆盖设计 §4.2 行为表：
 * <ul>
 *   <li>默认值 {@code new ApiPermissionProperties().isDenyUnmapped() == true}（验收 ④）；</li>
 *   <li>未登记路径 + denyUnmapped=true → HTTP 403 + {@code Result{code:40300, message:"接口未授权映射"}}（验收 ①）；</li>
 *   <li>已登记 + 未登录 → 40100「未认证」；已登记 + 有权限 → 放行；已登记 + 无权限 → 40300；</li>
 *   <li>已登记 authOnly（permission 为空派生） + 登录 → 放行（Q3/U1 反向信任豁免机制）；</li>
 *   <li>{@code /actuator}、{@code /error} 豁免放行（含 denyUnmapped=true）。</li>
 * </ul>
 */
class ApiPermissionDenyUnmappedTest {

    private static final Function<LoginUser, Set<String>> EMPTY_LOADER = u -> Set.of();
    private static final Function<LoginUser, Set<String>> PERM_LOADER =
            u -> Set.of("kb:library:list");

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clear();
    }

    private static ApiPermissionInterceptor interceptor(
            ApiPermissionProperties properties,
            List<ApiPermissionRule> rules,
            Function<LoginUser, Set<String>> loader) {
        ApiPermissionRegistry registry = new ApiPermissionRegistry();
        registry.replaceAll(rules);
        return new ApiPermissionInterceptor(registry, properties, loader);
    }

    private static BusinessException preHandleExpects(ApiPermissionInterceptor interceptor, String method, String path) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, path);
        MockHttpServletResponse response = new MockHttpServletResponse();
        return assertThrows(BusinessException.class,
                () -> interceptor.preHandle(request, response, new Object()));
    }

    // ---------------------------------------------------------------- 默认值

    @Test
    @DisplayName("默认值 fail-closed：new ApiPermissionProperties().isDenyUnmapped() == true")
    void defaultIsFailClosed() {
        assertTrue(new ApiPermissionProperties().isDenyUnmapped(),
                "denyUnmapped 默认值必须为 true（SEC-01，安全默认值 fail-closed）");
        assertTrue(new ApiPermissionProperties().isEnabled(), "enabled 默认 true 不变");
        assertEquals(300, new ApiPermissionProperties().getRefreshIntervalSeconds(),
                "refreshIntervalSeconds 默认 300s 不变");
    }

    // ---------------------------------------------------------------- 未登记 403

    @Test
    @DisplayName("未登记路径 + denyUnmapped=true → FORBIDDEN(40300) 接口未授权映射")
    void unmappedRejectedWhenDenyUnmapped() {
        ApiPermissionProperties properties = new ApiPermissionProperties();
        assertTrue(properties.isDenyUnmapped());
        ApiPermissionInterceptor interceptor = interceptor(properties, List.of(), EMPTY_LOADER);

        BusinessException ex = preHandleExpects(interceptor, "GET", "/api/v1/kb/unmapped-endpoint");
        assertEquals(ResultCode.FORBIDDEN.getCode(), ex.getCode(), "应为 40300");
        assertEquals(40300, ex.getCode(), "码值固化");
        assertEquals("接口未授权映射", ex.getMessage(), "fail-closed 未登记路径的固定文案");
    }

    @Test
    @DisplayName("未登记路径 + denyUnmapped=false（显式覆盖）→ 放行（fail-open 逃生口）")
    void unmappedAllowedWhenDenyUnmappedFalse() {
        ApiPermissionProperties properties = new ApiPermissionProperties();
        properties.setDenyUnmapped(false);
        ApiPermissionInterceptor interceptor = interceptor(properties, List.of(), EMPTY_LOADER);

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/kb/unmapped-endpoint");
        MockHttpServletResponse response = new MockHttpServletResponse();
        assertDoesNotThrow(() -> {
            boolean allowed = interceptor.preHandle(request, response, new Object());
            assertTrue(allowed, "denyUnmapped=false 时未登记路径应放行");
        });
    }

    // ---------------------------------------------------------------- 已登记 401/403/200

    @Test
    @DisplayName("已登记 + 未登录 → UNAUTHORIZED(40100)（先于权限比对）")
    void registeredRejectsUnauthenticated() {
        ApiPermissionInterceptor interceptor = interceptor(
                new ApiPermissionProperties(),
                List.of(new ApiPermissionRule("GET", "/api/v1/kb/libraries", "kb:library:list", false, 1)),
                PERM_LOADER);

        BusinessException ex = preHandleExpects(interceptor, "GET", "/api/v1/kb/libraries");
        assertEquals(ResultCode.UNAUTHORIZED.getCode(), ex.getCode(), "应为 40100");
        assertEquals(40100, ex.getCode(), "码值固化");
    }

    @Test
    @DisplayName("已登记 + 登录 + 无权限码 → FORBIDDEN(40300) 无权限")
    void registeredRejectsWithoutPermission() {
        ApiPermissionInterceptor interceptor = interceptor(
                new ApiPermissionProperties(),
                List.of(new ApiPermissionRule("GET", "/api/v1/kb/libraries", "kb:library:list", false, 1)),
                EMPTY_LOADER);

        LoginUser user = new LoginUser();
        user.setUserId(42L);
        SecurityContextHolder.setLoginUser(user);
        try {
            BusinessException ex = preHandleExpects(interceptor, "GET", "/api/v1/kb/libraries");
            assertEquals(ResultCode.FORBIDDEN.getCode(), ex.getCode(), "应为 40300 无权限");
            assertEquals(40300, ex.getCode());
        } finally {
            SecurityContextHolder.clear();
        }
    }

    @Test
    @DisplayName("已登记 + 登录 + 有权限码 → 放行（已登记零回归）")
    void registeredAllowsWithPermission() {
        ApiPermissionInterceptor interceptor = interceptor(
                new ApiPermissionProperties(),
                List.of(new ApiPermissionRule("GET", "/api/v1/kb/libraries", "kb:library:list", false, 1)),
                PERM_LOADER);

        LoginUser user = new LoginUser();
        user.setUserId(42L);
        SecurityContextHolder.setLoginUser(user);
        try {
            MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/kb/libraries");
            MockHttpServletResponse response = new MockHttpServletResponse();
            boolean allowed = interceptor.preHandle(request, response, new Object());
            assertTrue(allowed, "持有 kb:library:list 应放行");
        } finally {
            SecurityContextHolder.clear();
        }
    }

    // ---------------------------------------------------------------- authOnly

    @Test
    @DisplayName("已登记 authOnly（permission 为空派生）+ 登录 → 放行（Q3/U1 反向信任豁免）")
    void authOnlyPassesWhenLoggedIn() {
        // U1 裁决：skill/execute|apply 以 permission 为空登记 → authOnly（ApiService.java:38 原生派生）
        ApiPermissionInterceptor interceptor = interceptor(
                new ApiPermissionProperties(),
                List.of(new ApiPermissionRule("POST", "/api/v1/ai/skill/execute", null, true, 1)),
                EMPTY_LOADER);

        LoginUser user = new LoginUser();
        user.setUserId(7L);
        SecurityContextHolder.setLoginUser(user);
        try {
            MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/ai/skill/execute");
            MockHttpServletResponse response = new MockHttpServletResponse();
            boolean allowed = interceptor.preHandle(request, response, new Object());
            assertTrue(allowed, "authOnly 端点登录即可调（技能级判权由 SkillPermissionChecker 兜底）");
        } finally {
            SecurityContextHolder.clear();
        }
    }

    @Test
    @DisplayName("已登记 authOnly + 未登录 → UNAUTHORIZED(40100)（authOnly 仍需登录态）")
    void authOnlyRejectsWhenNotLoggedIn() {
        ApiPermissionInterceptor interceptor = interceptor(
                new ApiPermissionProperties(),
                List.of(new ApiPermissionRule("POST", "/api/v1/ai/skill/execute", null, true, 1)),
                EMPTY_LOADER);

        BusinessException ex = preHandleExpects(interceptor, "POST", "/api/v1/ai/skill/execute");
        assertEquals(ResultCode.UNAUTHORIZED.getCode(), ex.getCode(), "authOnly 未登录应 40100");
    }

    // ---------------------------------------------------------------- 豁免

    @Test
    @DisplayName("/actuator、/error 豁免放行（denyUnmapped=true 也不受影响）")
    void exemptPathsAlwaysAllowed() {
        ApiPermissionProperties properties = new ApiPermissionProperties();
        assertTrue(properties.isDenyUnmapped());
        ApiPermissionInterceptor interceptor = interceptor(properties, List.of(), EMPTY_LOADER);

        assertDoesNotThrow(() -> {
            MockHttpServletRequest actuator = new MockHttpServletRequest("GET", "/actuator/health");
            MockHttpServletResponse response = new MockHttpServletResponse();
            assertTrue(interceptor.preHandle(actuator, response, new Object()));
        });
        assertDoesNotThrow(() -> {
            MockHttpServletRequest error = new MockHttpServletRequest("GET", "/error");
            MockHttpServletResponse response = new MockHttpServletResponse();
            assertTrue(interceptor.preHandle(error, response, new Object()));
        });
    }

    // ---------------------------------------------------------------- 模块停用

    @Test
    @DisplayName("命中已停用模块规则 → 403 接口所属模块已停用（Q4，不受 denyUnmapped 影响）")
    void moduleDisabledStillRejected() {
        ApiPermissionProperties properties = new ApiPermissionProperties();
        properties.setDenyUnmapped(false);
        ApiPermissionInterceptor interceptor = interceptor(
                properties,
                List.of(new ApiPermissionRule("GET", "/api/v1/disabled", "p:a", false, 0)),
                EMPTY_LOADER);

        BusinessException ex = preHandleExpects(interceptor, "GET", "/api/v1/disabled");
        assertEquals(ResultCode.FORBIDDEN.getCode(), ex.getCode());
        assertEquals("接口所属模块已停用", ex.getMessage());
    }

    @Test
    @DisplayName("disabled 属性显式可设回 false（配置逃生口 MIS_API_PERMISSION_DENY_UNMAPPED=false）")
    void denyUnmappedCanBeExplicitlyDisabled() {
        ApiPermissionProperties properties = new ApiPermissionProperties();
        assertTrue(properties.isDenyUnmapped());
        properties.setDenyUnmapped(false);
        assertFalse(properties.isDenyUnmapped(), "显式覆盖后应可关闭（逃生口语义）");
    }
}
