package com.mis.adminbff.controller;

import com.mis.adminbff.dto.kb.KbHitTestRequest;
import com.mis.adminbff.dto.kb.KbHitTestResultVO;
import com.mis.adminbff.security.UserPermissionLoader;
import com.mis.adminbff.service.KbFacadeService;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.Result;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * {@code KbController#requireHitTestPermission()} 兜底判权的行为测试（P0-B 回归）。
 *
 * <p><b>固化的缺陷</b>：{@code ApiPermissionInterceptor:52-58} 对未在 {@code sys_api}
 * 登记的路径直接 {@code return true} 放行，叠加 BFF 的 {@code deny-unmapped=false}，
 * 在 V17 迁移真正落到目标库之前，{@code POST /api/v1/kb/hit-test} 等同「登录即可调」。
 * 兜底判权就是补这段空窗；本测试证明它真的拦得住，而不是只在注释里拦得住。
 *
 * <p><b>为什么不 mock {@code LoginUser.getPermissions()}</b>：该字段初值恒为
 * {@code Collections.emptySet()}，唯一的 {@code setPermissions} 调用点在
 * {@code ApiPermissionInterceptor:80}，位于「路径已映射」分支之后——恰恰在需要兜底的
 * 场景下永远为空。故被测代码走 {@link UserPermissionLoader#load(LoginUser)}，
 * 本测试也就 mock 这一个协作者。
 *
 * <p><b>断言口径</b>：拒绝路径除了断言异常码，还一律断言
 * {@code kbFacadeService} 零交互——这是「判权发生在任何业务逻辑/远程调用之前」的
 * 唯一可证伪证据。只断言抛异常是不够的：先调下游再抛异常同样能让异常断言通过，
 * 但 chunk 原文已经被取出来了。
 */
class KbControllerHitTestPermissionTest {

    private static final String PERM_HIT_TEST_RUN = "kb:hittest:run";

    private KbFacadeService kbFacadeService;
    private UserPermissionLoader userPermissionLoader;
    private KbController controller;

    private static final KbHitTestRequest REQUEST =
            new KbHitTestRequest(100L, "年假怎么休", null, null, null, null, null, null,
                    null, null, null);

    @BeforeEach
    void setUp() {
        kbFacadeService = mock(KbFacadeService.class);
        userPermissionLoader = mock(UserPermissionLoader.class);
        controller = new KbController(kbFacadeService, userPermissionLoader);
        SecurityContextHolder.clear();
    }

    @AfterEach
    void tearDown() {
        // ThreadLocal 必须清，否则同一线程上跑的后续用例会读到上一条的登录态
        SecurityContextHolder.clear();
    }

    private static LoginUser loginUser(Long userId) {
        LoginUser user = new LoginUser();
        user.setUserId(userId);
        user.setTenantId(1L);
        user.setAppId(91010L);
        user.setUsername("tester");
        return user;
    }

    // ---------------------------------------------------------------- 拒绝路径

    @Test
    @DisplayName("有身份但权限集不含 kb:hittest:run → FORBIDDEN(40300)，且不触达下游")
    void shouldRejectWithForbiddenWhenPermissionMissing() {
        LoginUser user = loginUser(42L);
        SecurityContextHolder.setLoginUser(user);
        when(userPermissionLoader.load(user))
                .thenReturn(Set.of("kb:library:list", "kb:qa:ask"));

        BusinessException ex = assertThrows(BusinessException.class,
                () -> controller.hitTest(REQUEST));

        assertEquals(ResultCode.FORBIDDEN.getCode(), ex.getCode(), "应为 40300 无权限");
        assertEquals(40300, ex.getCode(), "码值固化，防止 ResultCode 被改动后静默漂移");
        verifyNoInteractions(kbFacadeService);
    }

    @Test
    @DisplayName("权限集为空 → FORBIDDEN，且不触达下游")
    void shouldRejectWhenPermissionSetEmpty() {
        LoginUser user = loginUser(42L);
        SecurityContextHolder.setLoginUser(user);
        when(userPermissionLoader.load(user)).thenReturn(Set.of());

        BusinessException ex = assertThrows(BusinessException.class,
                () -> controller.hitTest(REQUEST));

        assertEquals(ResultCode.FORBIDDEN.getCode(), ex.getCode());
        verifyNoInteractions(kbFacadeService);
    }

    @Test
    @DisplayName("loader 返回 null（下游异常兜底）→ FORBIDDEN 而非 NPE")
    void shouldRejectWhenLoaderReturnsNull() {
        LoginUser user = loginUser(42L);
        SecurityContextHolder.setLoginUser(user);
        when(userPermissionLoader.load(user)).thenReturn(null);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> controller.hitTest(REQUEST));

        assertEquals(ResultCode.FORBIDDEN.getCode(), ex.getCode());
        verifyNoInteractions(kbFacadeService);
    }

    @Test
    @DisplayName("相近但不相等的权限码不得放行（contains 语义不能退化成前缀匹配）")
    void shouldNotAcceptSimilarPermissionCode() {
        LoginUser user = loginUser(42L);
        SecurityContextHolder.setLoginUser(user);
        when(userPermissionLoader.load(user))
                .thenReturn(Set.of("kb:hittest", "kb:hittest:run:all", "KB:HITTEST:RUN"));

        BusinessException ex = assertThrows(BusinessException.class,
                () -> controller.hitTest(REQUEST));

        assertEquals(ResultCode.FORBIDDEN.getCode(), ex.getCode());
        verifyNoInteractions(kbFacadeService);
    }

    @Test
    @DisplayName("已登录但 userId 为空 → UNAUTHORIZED(40100)，且不查权限、不触达下游")
    void shouldRejectWithUnauthorizedWhenUserIdNull() {
        SecurityContextHolder.setLoginUser(loginUser(null));

        BusinessException ex = assertThrows(BusinessException.class,
                () -> controller.hitTest(REQUEST));

        assertEquals(ResultCode.UNAUTHORIZED.getCode(), ex.getCode(), "应为 40100 未认证");
        assertEquals(40100, ex.getCode());
        // userId 为空时应短路，不应白跑一次权限查询（Redis / mis-iam）
        verifyNoInteractions(userPermissionLoader);
        verifyNoInteractions(kbFacadeService);
    }

    @Test
    @DisplayName("完全无登录上下文 → UNAUTHORIZED(40100)，且不触达下游")
    void shouldRejectWithUnauthorizedWhenNoLoginContext() {
        // 不设置 ThreadLocal，模拟 GatewayContextFilter 未写入上下文
        BusinessException ex = assertThrows(BusinessException.class,
                () -> controller.hitTest(REQUEST));

        assertEquals(ResultCode.UNAUTHORIZED.getCode(), ex.getCode());
        verifyNoInteractions(userPermissionLoader);
        verifyNoInteractions(kbFacadeService);
    }

    // ---------------------------------------------------------------- 放行路径

    @Test
    @DisplayName("权限集含 kb:hittest:run → 放行，且入参原样透传下游")
    void shouldAllowWhenPermissionPresent() {
        LoginUser user = loginUser(42L);
        SecurityContextHolder.setLoginUser(user);
        when(userPermissionLoader.load(user))
                .thenReturn(Set.of("kb:library:list", PERM_HIT_TEST_RUN));

        // KbHitTestResultVO 是 record（final），不能 mock，直接造真实实例
        KbHitTestResultVO expected =
                new KbHitTestResultVO(List.of(), null, 12L, "EMPTY", Boolean.FALSE, null);
        when(kbFacadeService.hitTest(any(KbHitTestRequest.class))).thenReturn(expected);

        Result<KbHitTestResultVO> result = controller.hitTest(REQUEST);

        assertNotNull(result);
        assertTrue(result.isSuccess(), "放行时应返回成功 Result");
        assertSame(expected, result.getData());
        // 证明 BFF 不做业务加工，请求体原样透传
        verify(kbFacadeService).hitTest(REQUEST);
    }

    @Test
    @DisplayName("仅持有 kb:hittest:run 一个码即可放行（不依赖其它权限码）")
    void shouldAllowWithOnlyTheHitTestPermission() {
        LoginUser user = loginUser(7L);
        SecurityContextHolder.setLoginUser(user);
        when(userPermissionLoader.load(user)).thenReturn(Set.of(PERM_HIT_TEST_RUN));

        controller.hitTest(REQUEST);

        verify(kbFacadeService).hitTest(REQUEST);
        verify(userPermissionLoader).load(user);
    }

    @Test
    @DisplayName("判权先于下游调用：拒绝时 facade 永不被调用（顺序回归锁）")
    void permissionCheckMustPrecedeDownstreamCall() {
        LoginUser user = loginUser(42L);
        SecurityContextHolder.setLoginUser(user);
        when(userPermissionLoader.load(user)).thenReturn(Set.of("kb:qa:ask"));

        assertThrows(BusinessException.class, () -> controller.hitTest(REQUEST));

        // 若将来有人把 requireHitTestPermission() 挪到 kbFacadeService.hitTest() 之后，
        // 这条断言会立刻失败。
        verify(kbFacadeService, never()).hitTest(any());
    }
}
