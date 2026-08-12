package com.mis.adminbff.security;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.common.security.permission.ApiPermissionInterceptor;
import com.mis.common.security.permission.ApiPermissionProperties;
import com.mis.common.security.permission.ApiPermissionRegistry;
import com.mis.common.security.permission.ApiPermissionRule;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.List;
import java.util.Set;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * BFF 侧 fail-closed 行为断言（SEC-01 验收，与 V32 补登联动）。
 *
 * <p>用 V32 登记表（设计 §1.7 的 28 端点 + 代表性既有端点）构建真实
 * {@link ApiPermissionRegistry}，驱动 {@link ApiPermissionInterceptor}（BFF 唯一 PEP，
 * {@code addPathPatterns("/api/v1/**")}，见 {@code ApiPermissionConfiguration:44}），验证：
 * <ul>
 *   <li>已登记端点有权限 → 200 放行（零回归）；</li>
 *   <li>已登记端点无权限 → 40300「无权限」；已登记未登录 → 40100「未认证」；</li>
 *   <li><b>未登记端点 → 40300「接口未授权映射」</b>（prod fail-closed 现状 + 本期推广行为）；</li>
 *   <li>authOnly 端点（V33 skill/execute|apply）登录即放行。</li>
 * </ul>
 * 未登记 403 的完整响应体（{@code Result{code:40300, message:"接口未授权映射", ...}}）由
 * 全局异常处理器组装，此处断言拦截器抛出的 {@link BusinessException} 码与文案（与设计 §4.2 一致）。
 */
class KbControllerFailClosedBehaviorTest {

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clear();
    }

    private static ApiPermissionInterceptor kbInterceptor(Set<String> userPerms) {
        ApiPermissionRegistry registry = new ApiPermissionRegistry();
        registry.replaceAll(KB_REGISTRY_RULES);
        ApiPermissionProperties properties = new ApiPermissionProperties();
        properties.setDenyUnmapped(true);
        Function<LoginUser, Set<String>> loader = user -> userPerms;
        return new ApiPermissionInterceptor(registry, properties, loader);
    }

    private static void login(Long userId) {
        LoginUser user = new LoginUser();
        user.setUserId(userId);
        user.setTenantId(1L);
        user.setAppId(91010L);
        user.setUsername("tester");
        SecurityContextHolder.setLoginUser(user);
    }

    private static BusinessException preHandleExpects(ApiPermissionInterceptor interceptor, String method, String path) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, path);
        MockHttpServletResponse response = new MockHttpServletResponse();
        return assertThrows(BusinessException.class,
                () -> interceptor.preHandle(request, response, new Object()));
    }

    private static boolean preHandleAllows(ApiPermissionInterceptor interceptor, String method, String path) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, path);
        MockHttpServletResponse response = new MockHttpServletResponse();
        return interceptor.preHandle(request, response, new Object());
    }

    // ---------------------------------------------------------------- 未登记 403

    @Test
    @DisplayName("未登记端点（非 KB 残留路径）→ FORBIDDEN(40300)「接口未授权映射」")
    void unmappedEndpointRejectedWith40300() {
        login(1L);
        ApiPermissionInterceptor interceptor = kbInterceptor(Set.of("kb:library:list"));
        BusinessException ex = preHandleExpects(interceptor, "GET", "/api/v1/kb/not-registered-yet");
        assertEquals(40300, ex.getCode(), "未登记端点必须 40300");
        assertEquals("接口未授权映射", ex.getMessage(), "固定文案与设计 §4.2 一致");
    }

    // ---------------------------------------------------------------- 已登记零回归

    @Test
    @DisplayName("READ-01 GET /kb/categories 有权限 → 放行；无权限 → 40300；未登录 → 40100")
    void read01CategoriesZeroRegression() {
        // 有权限
        login(1L);
        ApiPermissionInterceptor allowed = kbInterceptor(Set.of("kb:category:list"));
        assertTrue(preHandleAllows(allowed, "GET", "/api/v1/kb/categories"));

        // 无权限
        ApiPermissionInterceptor denied = kbInterceptor(Set.of("kb:library:list"));
        BusinessException ex = preHandleExpects(denied, "GET", "/api/v1/kb/categories");
        assertEquals(40300, ex.getCode(), "已登记无权限 → 40300 无权限");

        // 未登录
        SecurityContextHolder.clear();
        BusinessException unauth = preHandleExpects(denied, "GET", "/api/v1/kb/categories");
        assertEquals(40100, unauth.getCode(), "已登记未登录 → 40100 未认证");
    }

    @Test
    @DisplayName("WRITE-01 DELETE /kb/libraries/{id}：管理员有 kb:library:delete 放行，无权限 403")
    void write01DeleteLibrary() {
        login(1L);
        ApiPermissionInterceptor admin = kbInterceptor(Set.of("kb:library:delete"));
        assertTrue(preHandleAllows(admin, "DELETE", "/api/v1/kb/libraries/100"),
                "有 kb:library:delete 的管理员可删除知识库（fail-closed 下 200）");

        ApiPermissionInterceptor nonAdmin = kbInterceptor(Set.of("kb:library:list"));
        BusinessException ex = preHandleExpects(nonAdmin, "DELETE", "/api/v1/kb/libraries/100");
        assertEquals(40300, ex.getCode(), "无 kb:library:delete → 403");
    }

    @Test
    @DisplayName("READ-05 GET /kb/libraries/{id}/engine/settings：需 kb:library:edit（Q6 敏感设置能改才能看）")
    void read05EngineSettings() {
        login(1L);
        ApiPermissionInterceptor editor = kbInterceptor(Set.of("kb:library:edit"));
        assertTrue(preHandleAllows(editor, "GET", "/api/v1/kb/libraries/100/engine/settings"));

        ApiPermissionInterceptor viewer = kbInterceptor(Set.of("kb:library:list"));
        BusinessException ex = preHandleExpects(viewer, "GET", "/api/v1/kb/libraries/100/engine/settings");
        assertEquals(40300, ex.getCode(), "只有 kb:library:list 不能读 RAG 设置（Q6）");
    }

    @Test
    @DisplayName("READ-10 GET /kb/qa/sessions/{sessionId}：kb:qa:ask 放行")
    void read10QaSessionDetail() {
        login(1L);
        ApiPermissionInterceptor asker = kbInterceptor(Set.of("kb:qa:ask"));
        assertTrue(preHandleAllows(asker, "GET", "/api/v1/kb/qa/sessions/42"));
    }

    @Test
    @DisplayName("WRITE-03 POST /kb/operations/qa/tickets：kb:qa:ask 放行（设计 §1.7 映射）")
    void write03CreateTicket() {
        login(1L);
        ApiPermissionInterceptor asker = kbInterceptor(Set.of("kb:qa:ask"));
        assertTrue(preHandleAllows(asker, "POST", "/api/v1/kb/operations/qa/tickets"));
    }

    @Test
    @DisplayName("WRITE-04 PATCH /kb/operations/qa/tickets/{ticketId}：kb:operation:list 放行")
    void write04PatchTicket() {
        login(1L);
        ApiPermissionInterceptor operator = kbInterceptor(Set.of("kb:operation:list"));
        assertTrue(preHandleAllows(operator, "PATCH", "/api/v1/kb/operations/qa/tickets/9"));
    }

    // ---------------------------------------------------------------- authOnly（V33）

    @Test
    @DisplayName("V33 authOnly：POST /ai/skill/execute 登录即放行（技能级判权由 SkillPermissionChecker 兜底）")
    void authOnlySkillExecutePassesWhenLoggedIn() {
        login(1L);
        ApiPermissionInterceptor interceptor = kbInterceptor(Set.of());
        assertTrue(preHandleAllows(interceptor, "POST", "/api/v1/ai/skill/execute"),
                "authOnly 端点不要求 URL 权限码（U1），登录即到 Controller 由 SkillPermissionChecker 判权");
    }

    @Test
    @DisplayName("V33 authOnly 未登录 → 40100（authOnly 仍需登录态）")
    void authOnlySkillExecuteRejectsWhenNotLoggedIn() {
        ApiPermissionInterceptor interceptor = kbInterceptor(Set.of());
        BusinessException ex = preHandleExpects(interceptor, "POST", "/api/v1/ai/skill/apply");
        assertEquals(40100, ex.getCode());
    }

    // ---------------------------------------------------------------- 注册表 fixture

    /**
     * V32 登记表（28 端点，permission 按设计 §1.7）+ 代表性既有端点 + V33 authOnly 2 端点。
     * 与 {@code V32__kb_security_sprint.sql} / {@code V33__kb_security_sprint_authonly.sql} 逐字对齐。
     */
    private static final List<ApiPermissionRule> KB_REGISTRY_RULES = List.of(
            // READ-01~24
            rule("GET", "/api/v1/kb/categories", "kb:category:list"),
            rule("GET", "/api/v1/kb/libraries", "kb:library:list"),
            rule("GET", "/api/v1/kb/libraries/{id:[0-9]+}", "kb:library:list"),
            rule("GET", "/api/v1/kb/libraries/{id:[0-9]+}/detail", "kb:library:list"),
            rule("GET", "/api/v1/kb/libraries/{id:[0-9]+}/engine/settings", "kb:library:edit"),
            rule("GET", "/api/v1/kb/libraries/{libraryId:[0-9]+}/documents", "kb:document:list"),
            rule("GET", "/api/v1/kb/libraries/{libraryId:[0-9]+}/documents/{id:[0-9]+}", "kb:document:list"),
            rule("GET", "/api/v1/kb/libraries/{libraryId:[0-9]+}/acls", "kb:acl:list"),
            rule("GET", "/api/v1/kb/qa/sessions/mine", "kb:qa:ask"),
            rule("GET", "/api/v1/kb/qa/sessions/{sessionId}", "kb:qa:ask"),
            rule("GET", "/api/v1/kb/qa/sessions/{sessionId}/feedback", "kb:qa:ask"),
            rule("GET", "/api/v1/kb/operations/qa/sessions", "kb:operation:list"),
            rule("GET", "/api/v1/kb/operations/qa/sessions/{sessionId}", "kb:operation:list"),
            rule("GET", "/api/v1/kb/operations/qa/sessions-all", "kb:operation:list"),
            rule("GET", "/api/v1/kb/operations/qa/feedback", "kb:operation:list"),
            rule("GET", "/api/v1/kb/operations/stats", "kb:operation:list"),
            rule("GET", "/api/v1/kb/operations/qa/export", "kb:operation:list"),
            rule("GET", "/api/v1/kb/operations/qa/tickets", "kb:operation:list"),
            rule("GET", "/api/v1/kb/operations/qa/tickets/{ticketId}", "kb:operation:list"),
            rule("GET", "/api/v1/kb/operations/qa/tickets/by-session/{sessionId}", "kb:operation:list"),
            rule("GET", "/api/v1/kb/subjects/search", "kb:acl:list"),
            rule("GET", "/api/v1/kb/engine/health", "kb:engine:view"),
            rule("GET", "/api/v1/kb/engine/capabilities", "kb:engine:view"),
            rule("GET", "/api/v1/kb/engine/models", "kb:engine:view"),
            // WRITE-01~04
            rule("DELETE", "/api/v1/kb/libraries/{id:[0-9]+}", "kb:library:delete"),
            rule("POST", "/api/v1/kb/qa/feedback", "kb:qa:feedback"),
            rule("POST", "/api/v1/kb/operations/qa/tickets", "kb:qa:ask"),
            rule("PATCH", "/api/v1/kb/operations/qa/tickets/{ticketId}", "kb:operation:list"),
            // V33 authOnly（permission 为空 → authOnly 派生）
            rule("POST", "/api/v1/ai/skill/execute", null),
            rule("POST", "/api/v1/ai/skill/apply", null)
    );

    private static ApiPermissionRule rule(String method, String path, String permission) {
        boolean authOnly = permission == null || permission.isBlank();
        return new ApiPermissionRule(method, path, permission, authOnly, 1);
    }
}
