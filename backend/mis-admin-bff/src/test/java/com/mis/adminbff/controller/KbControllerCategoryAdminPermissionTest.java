package com.mis.adminbff.controller;

import com.mis.adminbff.dto.kb.KbCategoryAdminCreateRequest;
import com.mis.adminbff.dto.kb.KbCategoryAdminVO;
import com.mis.adminbff.dto.kb.KbCategoryVO;
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

import java.time.Instant;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * {@code KbController#requireCategoryManagePermission()} 兜底判权的行为测试
 * （知识库域一期，T03）。
 *
 * <p>覆盖 4 个受 {@code kb:category:manage} 门控的端点：移动分类、管理员列表、
 * 新增管理员、移除管理员。{@code GET /categories/manageable-ids} 仅需
 * {@code kb:category:list}，不在本测试范围。
 *
 * <p><b>与 {@code KbControllerHitTestPermissionTest} 同源风险</b>：{@code ApiPermissionInterceptor}
 * 对未登记路径放行 + {@code deny-unmapped=false}，V24 迁移落地前本组端点等同「登录即可调」，
 * 本测试证明兜底判权真的拦得住。
 *
 * <p><b>断言口径</b>：拒绝路径除断言异常码外，一律断言 {@code kbFacadeService} 零交互
 * ——判权必须发生在任何业务逻辑/远程调用之前。
 */
class KbControllerCategoryAdminPermissionTest {

    private static final String PERM_CATEGORY_MANAGE = "kb:category:manage";

    private KbFacadeService kbFacadeService;
    private UserPermissionLoader userPermissionLoader;
    private KbController controller;

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

    // ---------------------------------------------------------------- 拒绝路径：无权限码

    @Test
    @DisplayName("moveCategory：权限集不含 kb:category:manage → FORBIDDEN(40300)，且不触达下游")
    void moveRejectsWithForbiddenWhenPermissionMissing() {
        LoginUser user = loginUser(42L);
        SecurityContextHolder.setLoginUser(user);
        when(userPermissionLoader.load(user)).thenReturn(Set.of("kb:category:list"));

        BusinessException ex = assertThrows(BusinessException.class,
                () -> controller.moveCategory(2L, new KbController.CategoryMoveBody(1L)));

        assertEquals(40300, ex.getCode(), "码值固化，防止 ResultCode 被改动后静默漂移");
        verifyNoInteractions(kbFacadeService);
    }

    @Test
    @DisplayName("listCategoryAdmins：无权限码 → FORBIDDEN，且不触达下游")
    void listAdminsRejectsWhenPermissionMissing() {
        LoginUser user = loginUser(42L);
        SecurityContextHolder.setLoginUser(user);
        when(userPermissionLoader.load(user)).thenReturn(Set.of("kb:category:list"));

        BusinessException ex = assertThrows(BusinessException.class,
                () -> controller.listCategoryAdmins(2L));

        assertEquals(ResultCode.FORBIDDEN.getCode(), ex.getCode());
        verifyNoInteractions(kbFacadeService);
    }

    @Test
    @DisplayName("grantCategoryAdmin：无权限码 → FORBIDDEN，且不触达下游")
    void grantRejectsWhenPermissionMissing() {
        LoginUser user = loginUser(42L);
        SecurityContextHolder.setLoginUser(user);
        when(userPermissionLoader.load(user)).thenReturn(Set.of("kb:category:list"));

        BusinessException ex = assertThrows(BusinessException.class,
                () -> controller.grantCategoryAdmin(
                        2L, new KbCategoryAdminCreateRequest("user", 5L)));

        assertEquals(ResultCode.FORBIDDEN.getCode(), ex.getCode());
        verifyNoInteractions(kbFacadeService);
    }

    @Test
    @DisplayName("revokeCategoryAdmin：无权限码 → FORBIDDEN，且不触达下游")
    void revokeRejectsWhenPermissionMissing() {
        LoginUser user = loginUser(42L);
        SecurityContextHolder.setLoginUser(user);
        when(userPermissionLoader.load(user)).thenReturn(Set.of("kb:category:list"));

        BusinessException ex = assertThrows(BusinessException.class,
                () -> controller.revokeCategoryAdmin(9L));

        assertEquals(ResultCode.FORBIDDEN.getCode(), ex.getCode());
        verifyNoInteractions(kbFacadeService);
    }

    // ---------------------------------------------------------------- 拒绝路径：空集 / null / 相似码

    @Test
    @DisplayName("权限集为空 → FORBIDDEN，且不触达下游")
    void shouldRejectWhenPermissionSetEmpty() {
        LoginUser user = loginUser(42L);
        SecurityContextHolder.setLoginUser(user);
        when(userPermissionLoader.load(user)).thenReturn(Set.of());

        BusinessException ex = assertThrows(BusinessException.class,
                () -> controller.revokeCategoryAdmin(9L));

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
                () -> controller.moveCategory(2L, new KbController.CategoryMoveBody(1L)));

        assertEquals(ResultCode.FORBIDDEN.getCode(), ex.getCode());
        verifyNoInteractions(kbFacadeService);
    }

    @Test
    @DisplayName("相近但不相等的权限码不得放行（contains 语义不能退化成前缀匹配）")
    void shouldNotAcceptSimilarPermissionCode() {
        LoginUser user = loginUser(42L);
        SecurityContextHolder.setLoginUser(user);
        when(userPermissionLoader.load(user))
                .thenReturn(Set.of("kb:category", "kb:category:manage:all", "KB:CATEGORY:MANAGE"));

        BusinessException ex = assertThrows(BusinessException.class,
                () -> controller.grantCategoryAdmin(
                        2L, new KbCategoryAdminCreateRequest("role", 100L)));

        assertEquals(ResultCode.FORBIDDEN.getCode(), ex.getCode());
        verifyNoInteractions(kbFacadeService);
    }

    // ---------------------------------------------------------------- 拒绝路径：未认证

    @Test
    @DisplayName("已登录但 userId 为空 → UNAUTHORIZED(40100)，且不查权限、不触达下游")
    void shouldRejectWithUnauthorizedWhenUserIdNull() {
        SecurityContextHolder.setLoginUser(loginUser(null));

        BusinessException ex = assertThrows(BusinessException.class,
                () -> controller.listCategoryAdmins(2L));

        assertEquals(40100, ex.getCode(), "码值固化");
        // userId 为空时应短路，不应白跑一次权限查询（Redis / mis-iam）
        verifyNoInteractions(userPermissionLoader);
        verifyNoInteractions(kbFacadeService);
    }

    @Test
    @DisplayName("完全无登录上下文 → UNAUTHORIZED(40100)，且不触达下游")
    void shouldRejectWithUnauthorizedWhenNoLoginContext() {
        // 不设置 ThreadLocal，模拟 GatewayContextFilter 未写入上下文
        BusinessException ex = assertThrows(BusinessException.class,
                () -> controller.revokeCategoryAdmin(9L));

        assertEquals(ResultCode.UNAUTHORIZED.getCode(), ex.getCode());
        verifyNoInteractions(userPermissionLoader);
        verifyNoInteractions(kbFacadeService);
    }

    // ---------------------------------------------------------------- 放行路径

    @Test
    @DisplayName("moveCategory：权限集含 kb:category:manage → 放行，且参数原样透传下游")
    void moveAllowsWhenPermissionPresent() {
        LoginUser user = loginUser(42L);
        SecurityContextHolder.setLoginUser(user);
        when(userPermissionLoader.load(user)).thenReturn(Set.of(PERM_CATEGORY_MANAGE));

        KbCategoryVO expected = new KbCategoryVO(
                2L, 1L, "改名", 1, 0, null, Instant.now(), Instant.now());
        when(kbFacadeService.moveCategory(2L, 1L)).thenReturn(expected);

        Result<KbCategoryVO> result = controller.moveCategory(
                2L, new KbController.CategoryMoveBody(1L));

        assertNotNull(result);
        assertTrue(result.isSuccess(), "放行时应返回成功 Result");
        assertSame(expected, result.getData());
        verify(kbFacadeService).moveCategory(2L, 1L);
    }

    @Test
    @DisplayName("listCategoryAdmins：权限集含 kb:category:manage → 放行")
    void listAdminsAllowsWhenPermissionPresent() {
        LoginUser user = loginUser(42L);
        SecurityContextHolder.setLoginUser(user);
        when(userPermissionLoader.load(user)).thenReturn(Set.of(PERM_CATEGORY_MANAGE));

        KbCategoryAdminVO row = new KbCategoryAdminVO(
                9L, 2L, "user", 5L, 42L, Instant.now(), Instant.now());
        when(kbFacadeService.listCategoryAdmins(2L)).thenReturn(List.of(row));

        Result<List<KbCategoryAdminVO>> result = controller.listCategoryAdmins(2L);

        assertNotNull(result);
        assertTrue(result.isSuccess());
        assertEquals(1, result.getData().size());
        assertEquals(5L, result.getData().get(0).subjectId());
        verify(kbFacadeService).listCategoryAdmins(2L);
    }

    @Test
    @DisplayName("grantCategoryAdmin：权限集含 kb:category:manage → 放行，且入参透传下游")
    void grantAllowsWhenPermissionPresent() {
        LoginUser user = loginUser(42L);
        SecurityContextHolder.setLoginUser(user);
        when(userPermissionLoader.load(user)).thenReturn(Set.of(PERM_CATEGORY_MANAGE));

        KbCategoryAdminVO row = new KbCategoryAdminVO(
                9L, 2L, "role", 100L, 42L, Instant.now(), Instant.now());
        when(kbFacadeService.grantCategoryAdmin(2L, "role", 100L)).thenReturn(row);

        Result<KbCategoryAdminVO> result = controller.grantCategoryAdmin(
                2L, new KbCategoryAdminCreateRequest("role", 100L));

        assertNotNull(result);
        assertTrue(result.isSuccess());
        assertSame(row, result.getData());
        verify(kbFacadeService).grantCategoryAdmin(2L, "role", 100L);
    }

    @Test
    @DisplayName("revokeCategoryAdmin：权限集含 kb:category:manage → 放行")
    void revokeAllowsWhenPermissionPresent() {
        LoginUser user = loginUser(42L);
        SecurityContextHolder.setLoginUser(user);
        when(userPermissionLoader.load(user)).thenReturn(Set.of(PERM_CATEGORY_MANAGE));

        Result<Void> result = controller.revokeCategoryAdmin(9L);

        assertNotNull(result);
        assertTrue(result.isSuccess());
        verify(kbFacadeService).revokeCategoryAdmin(9L);
    }

    // ---------------------------------------------------------------- 顺序锁

    @Test
    @DisplayName("判权先于下游调用：拒绝时 facade 永不被调用（顺序回归锁）")
    void permissionCheckMustPrecedeDownstreamCall() {
        LoginUser user = loginUser(42L);
        SecurityContextHolder.setLoginUser(user);
        when(userPermissionLoader.load(user)).thenReturn(Set.of("kb:category:list"));

        assertThrows(BusinessException.class,
                () -> controller.moveCategory(2L, new KbController.CategoryMoveBody(1L)));

        // 若将来有人把 requireCategoryManagePermission() 挪到 kbFacadeService.moveCategory() 之后，
        // 这条断言会立刻失败。
        verify(kbFacadeService, never()).moveCategory(any(), any());
        verify(kbFacadeService, never()).grantCategoryAdmin(any(), any(), any());
        verify(kbFacadeService, never()).revokeCategoryAdmin(any());
    }
}
