package com.mis.kb.domain.service;

import com.mis.kb.api.client.KbSubjectClient;
import com.mis.kb.domain.entity.KbCategory;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.repository.KbAclRepository;
import com.mis.kb.domain.repository.KbCategoryAdminRepository;
import com.mis.kb.domain.repository.KbCategoryRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.support.KbBusinessException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * {@link NodeAdminResolver} 管辖判定链单测（知识库域一期，对齐 PRD §10 验收 3 的 8 类用例）。
 *
 * <p>树形：
 * <pre>
 *   1 (根)
 *   └─ 2
 *      └─ 3
 *   4 (根)
 *   └─ 5
 * </pre>
 *
 * <p>纯 Mockito 零 Spring 上下文（沿用 {@code KbDocumentServiceReparseAllTest} 风格）；
 * 全局管理员角色码固定为 {@code TENANT_ADMIN}（测试注入字面量，与默认配置一致）。
 */
class NodeAdminResolverTest {

    private static final long USER = 10L;
    private static final long ROLE = 100L;
    private static final long DEPT = 200L;

    private KbCategoryAdminRepository adminRepository;
    private KbCategoryRepository categoryRepository;
    private KbLibraryRepository libraryRepository;
    private KbAclRepository aclRepository;
    private KbSubjectClient subjectClient;
    private NodeAdminResolver resolver;

    @BeforeEach
    void setUp() {
        adminRepository = mock(KbCategoryAdminRepository.class);
        categoryRepository = mock(KbCategoryRepository.class);
        libraryRepository = mock(KbLibraryRepository.class);
        aclRepository = mock(KbAclRepository.class);
        subjectClient = mock(KbSubjectClient.class);
        resolver = new NodeAdminResolver(
                adminRepository, categoryRepository, libraryRepository, aclRepository,
                subjectClient, "TENANT_ADMIN");

        // 默认：非全局管理员、无角色/部门
        when(subjectClient.fetchUserRoleCodes(USER)).thenReturn(List.of());
        when(subjectClient.fetchUserRoleIds(USER)).thenReturn(List.of());
        when(subjectClient.fetchUserDeptIds(USER)).thenReturn(List.of());
        when(categoryRepository.findAll()).thenReturn(categories());
    }

    // ---------------------------------------------------------------- 树形数据

    private static List<KbCategory> categories() {
        KbCategory c1 = category(1L, null);
        KbCategory c2 = category(2L, 1L);
        KbCategory c3 = category(3L, 2L);
        KbCategory c4 = category(4L, null);
        KbCategory c5 = category(5L, 4L);
        return List.of(c1, c2, c3, c4, c5);
    }

    private static KbCategory category(long id, Long parentId) {
        KbCategory c = new KbCategory();
        c.setId(id);
        c.setParentId(parentId);
        c.setName("分类" + id);
        c.setEnabled(1);
        c.setSort(0);
        return c;
    }

    // ---------------------------------------------------------------- 用例 1：全局管理员短路

    @Test
    @DisplayName("角色码含 TENANT_ADMIN → 无任何授权行也放行（全局短路）")
    void globalAdminShortCircuits() {
        when(subjectClient.fetchUserRoleCodes(USER)).thenReturn(List.of("TENANT_ADMIN"));
        when(adminRepository.existsByCategoryIdAndSubjectTypeAndSubjectIdIn(
                eq(3L), eq("user"), anyList())).thenReturn(false);

        assertTrue(resolver.hasNodeManage(USER, 3L));
        // 短路后不应再查祖先链授权（无 admin 行也被放行）
        assertTrue(resolver.hasNodeManage(USER, 5L));
    }

    @Test
    @DisplayName("userId 为 null → 一律拒绝（fail-closed）")
    void nullUserIsRejected() {
        assertFalse(resolver.hasNodeManage(null, 3L));
        assertTrue(resolver.resolveManageableCategoryIds(null).isEmpty());
        assertFalse(resolver.hasLibraryManage(null, 99L));
    }

    // ---------------------------------------------------------------- 用例 2：直接授权命中

    @Test
    @DisplayName("节点自身有 user 授权 → 命中")
    void directGrantHits() {
        when(adminRepository.existsByCategoryIdAndSubjectTypeAndSubjectIdIn(
                eq(3L), eq("user"), anyList())).thenReturn(true);

        assertTrue(resolver.hasNodeManage(USER, 3L));
    }

    // ---------------------------------------------------------------- 用例 3：祖先继承

    @Test
    @DisplayName("祖父节点有授权 → 后代节点继承命中（3 沿 2 → 1）")
    void ancestorInheritanceHits() {
        when(adminRepository.existsByCategoryIdAndSubjectTypeAndSubjectIdIn(
                eq(1L), eq("user"), anyList())).thenReturn(true);

        assertTrue(resolver.hasNodeManage(USER, 3L));
        assertTrue(resolver.hasNodeManage(USER, 2L));
        assertFalse(resolver.hasNodeManage(USER, 5L));
    }

    // ---------------------------------------------------------------- 用例 4：角色命中

    @Test
    @DisplayName("角色授权命中：用户挂角色 100，节点 2 授权 role 100 → 节点 3 可管")
    void roleGrantHits() {
        when(subjectClient.fetchUserRoleIds(USER)).thenReturn(List.of(ROLE));
        when(adminRepository.existsByCategoryIdAndSubjectTypeAndSubjectIdIn(
                eq(2L), eq("role"), anyList())).thenReturn(true);

        assertTrue(resolver.hasNodeManage(USER, 3L));
    }

    // ---------------------------------------------------------------- 用例 5：部门命中

    @Test
    @DisplayName("部门授权命中：用户挂部门 200，节点 4 授权 dept 200 → 节点 5 可管")
    void deptGrantHits() {
        when(subjectClient.fetchUserDeptIds(USER)).thenReturn(List.of(DEPT));
        when(adminRepository.existsByCategoryIdAndSubjectTypeAndSubjectIdIn(
                eq(4L), eq("dept"), anyList())).thenReturn(true);

        assertTrue(resolver.hasNodeManage(USER, 5L));
        // 部门授权不跨树：节点 3 仍不可管
        assertFalse(resolver.hasNodeManage(USER, 3L));
    }

    // ---------------------------------------------------------------- 用例 6：无授权拒绝

    @Test
    @DisplayName("无任何授权行 → 拒绝")
    void noGrantRejects() {
        assertFalse(resolver.hasNodeManage(USER, 3L));
        assertFalse(resolver.hasNodeManage(USER, 1L));
        assertTrue(resolver.resolveManageableCategoryIds(USER).isEmpty());
    }

    // ---------------------------------------------------------------- 用例 7：移动范围

    @Test
    @DisplayName("移动范围：目标在管辖内可移；管辖外拒绝")
    void moveScope() {
        // 用户直接管 2（子树 {2,3}）与 4（子树 {4,5}）
        when(adminRepository.existsByCategoryIdAndSubjectTypeAndSubjectIdIn(
                eq(2L), eq("user"), anyList())).thenReturn(true);
        when(adminRepository.existsByCategoryIdAndSubjectTypeAndSubjectIdIn(
                eq(4L), eq("user"), anyList())).thenReturn(true);

        // 3 → 4：3 可管（沿 2）、4 可管（直接）→ 允许
        assertTrue(resolver.canMove(USER, 3L, 4L));
        // 3 → 5：5 可管（沿 4）→ 允许
        assertTrue(resolver.canMove(USER, 3L, 5L));
        // 3 → 1：1 不可管（无授权、非全局）→ 越权拒绝
        assertFalse(resolver.canMove(USER, 3L, 1L));
        // 3 → null（移为根，Q8 收紧）：用户直接管根节点 4 → 目标「根层级」在管辖内 → 允许
        assertTrue(resolver.canMove(USER, 3L, null));
    }

    @Test
    @DisplayName("移为根收紧（Q8）：未管辖任何根节点 → 拒绝；能管根节点/全局管理员 → 放行")
    void moveToRootRequiresRootJurisdiction() {
        // 用户只直接管 2（子树 {2,3}），未管任何根节点（1、4 均无授权、非全局）
        when(adminRepository.existsByCategoryIdAndSubjectTypeAndSubjectIdIn(
                eq(2L), eq("user"), anyList())).thenReturn(true);

        // 移为根：目标「根层级」不在管辖内 → 拒绝（canMove=false，assertCanMove 抛 40312）
        assertFalse(resolver.canMove(USER, 3L, null));
        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> resolver.assertCanMove(USER, 3L, null));
        assertEquals(40312, ex.getCode());

        // 能管根节点 4（直接授权）→ 移为根放行
        when(adminRepository.existsByCategoryIdAndSubjectTypeAndSubjectIdIn(
                eq(4L), eq("user"), anyList())).thenReturn(true);
        assertTrue(resolver.canMove(USER, 3L, null));

        // 全局管理员短路 → 即使无任何根授权也放行
        when(subjectClient.fetchUserRoleCodes(USER)).thenReturn(List.of("TENANT_ADMIN"));
        when(adminRepository.existsByCategoryIdAndSubjectTypeAndSubjectIdIn(
                eq(2L), eq("user"), anyList())).thenReturn(false);
        when(adminRepository.existsByCategoryIdAndSubjectTypeAndSubjectIdIn(
                eq(4L), eq("user"), anyList())).thenReturn(false);
        assertTrue(resolver.canMove(USER, 3L, null));
    }

    @Test
    @DisplayName("移动越权：assertCanMove 抛 40312（MOVE_OUT_OF_SCOPE）")
    void assertCanMoveThrowsOutOfScope() {
        when(adminRepository.existsByCategoryIdAndSubjectTypeAndSubjectIdIn(
                eq(2L), eq("user"), anyList())).thenReturn(true);

        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> resolver.assertCanMove(USER, 3L, 1L));
        assertEquals(40312, ex.getCode());
    }

    @Test
    @DisplayName("移动无管理权：assertCanMove 抛 40311（NOT_MANAGEABLE）")
    void assertCanMoveThrowsNotManageable() {
        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> resolver.assertCanMove(USER, 3L, 4L));
        assertEquals(40311, ex.getCode());
    }

    // ---------------------------------------------------------------- 用例 8：防环

    @Test
    @DisplayName("防环：目标是自己后代 → 拒绝；assertCanMove 抛 40933（MOVE_CYCLE）")
    void cycleRejected() {
        when(subjectClient.fetchUserRoleCodes(USER)).thenReturn(List.of("TENANT_ADMIN"));

        // 1 是根，3 是 1 的后代 → 1 移到 3 下构成环
        assertFalse(resolver.canMove(USER, 1L, 3L));
        assertFalse(resolver.canMove(USER, 2L, 3L));

        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> resolver.assertCanMove(USER, 1L, 3L));
        assertEquals(40933, ex.getCode());
    }

    @Test
    @DisplayName("移到自身 → 环拒绝")
    void moveToItselfRejected() {
        when(subjectClient.fetchUserRoleCodes(USER)).thenReturn(List.of("TENANT_ADMIN"));

        assertFalse(resolver.canMove(USER, 3L, 3L));
    }

    // ---------------------------------------------------------------- 子树并集

    @Test
    @DisplayName("resolveManageableCategoryIds：授权节点子树并集（2 → {2,3}，4 → {4,5}）")
    void manageableIdsAreSubtreeUnion() {
        when(subjectClient.fetchUserRoleIds(USER)).thenReturn(List.of(ROLE));
        when(adminRepository.findBySubjectTypeAndSubjectIdIn(eq("user"), anyList()))
                .thenReturn(List.of(adminRow(11L, 2L, "user", USER)));
        when(adminRepository.findBySubjectTypeAndSubjectIdIn(eq("role"), anyList()))
                .thenReturn(List.of(adminRow(12L, 4L, "role", ROLE)));

        Set<Long> ids = resolver.resolveManageableCategoryIds(USER);

        assertEquals(Set.of(2L, 3L, 4L, 5L), ids);
    }

    @Test
    @DisplayName("resolveManageableCategoryIds：全局管理员 → 全量节点")
    void manageableIdsAllForGlobalAdmin() {
        when(subjectClient.fetchUserRoleCodes(USER)).thenReturn(List.of("TENANT_ADMIN"));

        assertEquals(Set.of(1L, 2L, 3L, 4L, 5L), resolver.resolveManageableCategoryIds(USER));
    }

    @Test
    @DisplayName("resolveManageableCategoryIds：部门授权并入并集（user 2 + dept 4 → {2,3,4,5}）")
    void manageableIdsUnionIncludesDept() {
        when(subjectClient.fetchUserDeptIds(USER)).thenReturn(List.of(DEPT));
        when(adminRepository.findBySubjectTypeAndSubjectIdIn(eq("user"), anyList()))
                .thenReturn(List.of(adminRow(11L, 2L, "user", USER)));
        when(adminRepository.findBySubjectTypeAndSubjectIdIn(eq("dept"), anyList()))
                .thenReturn(List.of(adminRow(13L, 4L, "dept", DEPT)));

        Set<Long> ids = resolver.resolveManageableCategoryIds(USER);

        assertEquals(Set.of(2L, 3L, 4L, 5L), ids);
    }

    // ---------------------------------------------------------------- 库级合成（Q9）

    @Test
    @DisplayName("hasLibraryManage：节点管辖命中即 true（无需 kb_acl）")
    void libraryManageByNode() {
        KbLibrary lib = library(99L, 2L);
        when(libraryRepository.findById(99L)).thenReturn(Optional.of(lib));
        when(adminRepository.existsByCategoryIdAndSubjectTypeAndSubjectIdIn(
                eq(2L), eq("user"), anyList())).thenReturn(true);

        assertTrue(resolver.hasLibraryManage(USER, 99L));
    }

    @Test
    @DisplayName("hasLibraryManage：kb_acl.manage 命中即 true（无需节点授权）")
    void libraryManageByAcl() {
        KbLibrary lib = library(99L, 2L);
        when(libraryRepository.findById(99L)).thenReturn(Optional.of(lib));
        when(aclRepository.existsByLibraryIdAndSubjectTypeAndSubjectIdAndAction(
                eq(99L), eq("user"), eq(USER), eq("manage"))).thenReturn(true);

        assertTrue(resolver.hasLibraryManage(USER, 99L));
    }

    @Test
    @DisplayName("hasLibraryManage：节点未命中且无 kb_acl → false")
    void libraryManageRejected() {
        KbLibrary lib = library(99L, 2L);
        when(libraryRepository.findById(99L)).thenReturn(Optional.of(lib));

        assertFalse(resolver.hasLibraryManage(USER, 99L));
    }

    @Test
    @DisplayName("hasLibraryManage：角色级 kb_acl.manage 命中")
    void libraryManageByRoleAcl() {
        KbLibrary lib = library(99L, 2L);
        when(libraryRepository.findById(99L)).thenReturn(Optional.of(lib));
        when(subjectClient.fetchUserRoleIds(USER)).thenReturn(List.of(ROLE));
        when(aclRepository.existsByLibraryIdAndSubjectTypeAndSubjectIdAndAction(
                eq(99L), eq("role"), eq(ROLE), eq("manage"))).thenReturn(true);

        assertTrue(resolver.hasLibraryManage(USER, 99L));
    }

    @Test
    @DisplayName("hasLibraryManage：部门级 kb_acl.manage 命中（三主体并集完整）")
    void libraryManageByDeptAcl() {
        KbLibrary lib = library(99L, 2L);
        when(libraryRepository.findById(99L)).thenReturn(Optional.of(lib));
        when(subjectClient.fetchUserDeptIds(USER)).thenReturn(List.of(DEPT));
        when(aclRepository.existsByLibraryIdAndSubjectTypeAndSubjectIdAndAction(
                eq(99L), eq("dept"), eq(DEPT), eq("manage"))).thenReturn(true);

        assertTrue(resolver.hasLibraryManage(USER, 99L));
    }

    @Test
    @DisplayName("hasLibraryManage：知识库不存在 → false（不误放行）")
    void libraryManageLibraryNotFound() {
        when(libraryRepository.findById(404L)).thenReturn(Optional.empty());

        assertFalse(resolver.hasLibraryManage(USER, 404L));
    }

    // ---------------------------------------------------------------- 断言

    @Test
    @DisplayName("assertNodeManage：无管理权抛 40311")
    void assertNodeManageThrows() {
        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> resolver.assertNodeManage(USER, 3L));
        assertEquals(40311, ex.getCode());
    }

    // ---------------------------------------------------------------- 辅助

    private static com.mis.kb.domain.entity.KbCategoryAdmin adminRow(
            long id, long categoryId, String subjectType, long subjectId) {
        com.mis.kb.domain.entity.KbCategoryAdmin a = new com.mis.kb.domain.entity.KbCategoryAdmin();
        a.setId(id);
        a.setCategoryId(categoryId);
        a.setSubjectType(subjectType);
        a.setSubjectId(subjectId);
        return a;
    }

    private static KbLibrary library(long id, long categoryId) {
        KbLibrary lib = new KbLibrary();
        lib.setId(id);
        lib.setCategoryId(categoryId);
        lib.setName("库" + id);
        lib.setSecrecy("internal");
        lib.setStatus(1);
        return lib;
    }
}
