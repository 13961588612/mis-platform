package com.mis.kb.domain.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.kb.api.dto.KbAclCreateRequest;
import com.mis.kb.api.dto.KbAclVO;
import com.mis.kb.api.dto.LegacyAclInventoryVO;
import com.mis.kb.domain.entity.KbAcl;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.repository.KbAclRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.support.KbBusinessException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link KbAclService} 权限模型改造单测（KBP-09 grant/revoke 双闸门 + KBP-10 存量只读清单）。
 *
 * <p><b>双闸门口径（与设计一致）：</b>
 * <ol>
 *   <li>grant/revoke 前置 {@code hasLibraryManage}（节点管辖 ∨ kb_acl.manage），不通过 → 40311；</li>
 *   <li>grant 仅允许 {@code action=read}，非 read 直接 400（存量 manage/acl 零迁移兼容生效，
 *       但不再提供新增入口）；</li>
 *   <li>KBP-10 清单仅全局管理员可见（非全局管理员 → 40311），固定查 {@code action IN (manage,acl)}
 *       存量行，{@code subjectName} 恒为 {@code null}（BFF 回填）。</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class KbAclServiceTest {

    private static final long USER_ID = 7L;
    private static final long LIBRARY_ID = 100L;
    private static final long ACL_ID = 900L;
    private static final long SUBJECT_ID = 42L;
    private static final long CATEGORY_ID = 3L;

    @Mock
    private KbAclRepository aclRepository;
    @Mock
    private KbLibraryRepository libraryRepository;
    @Mock
    private NodeAdminResolver nodeAdminResolver;

    private KbAclService service;
    private KbLibrary library;

    @BeforeEach
    void setUp() {
        service = new KbAclService(aclRepository, libraryRepository, nodeAdminResolver);

        library = new KbLibrary();
        library.setId(LIBRARY_ID);
        library.setName("员工手册");
        library.setCategoryId(CATEGORY_ID);
        library.setStatus(1);

        when(libraryRepository.findById(LIBRARY_ID)).thenReturn(Optional.of(library));
        // 默认放行「可管理」判定——既有正分支语义不受管辖干扰；越权负分支单独关
        when(nodeAdminResolver.hasLibraryManage(eq(USER_ID), eq(LIBRARY_ID))).thenReturn(true);
    }

    // ---------------------------------------------------------------- grant

    @Nested
    @DisplayName("grant：双闸门")
    class Grant {

        private KbAclCreateRequest readGrant() {
            return new KbAclCreateRequest(SUBJECT_ID, "user", "read");
        }

        @Test
        @DisplayName("★ KBP-09①：库不在管理范围 → 40311，且零写入")
        void grantRejectedWhenNotManageable() {
            when(nodeAdminResolver.hasLibraryManage(eq(USER_ID), eq(LIBRARY_ID))).thenReturn(false);

            KbBusinessException ex = assertThrows(KbBusinessException.class,
                    () -> service.grant(USER_ID, LIBRARY_ID, readGrant()));

            assertEquals(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE.getCode(), ex.getCode());
            verify(aclRepository, never()).save(any(KbAcl.class));
        }

        @Test
        @DisplayName("★ KBP-09②：grant 非 read 动作（manage/acl）→ 400 VALIDATION_ERROR，零写入")
        void grantRejectsNonReadAction() {
            KbAclCreateRequest manageGrant = new KbAclCreateRequest(SUBJECT_ID, "user", "manage");

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> service.grant(USER_ID, LIBRARY_ID, manageGrant));

            assertEquals(ResultCode.VALIDATION_ERROR.getCode(), ex.getCode());
            assertTrue(ex.getMessage().contains("只读"),
                    "提示语必须说清「仅支持授予只读（read）权限」");
            verify(aclRepository, never()).save(any(KbAcl.class));
        }

        @Test
        @DisplayName("grant 非法 subjectType → 400 VALIDATION_ERROR")
        void grantRejectsIllegalSubjectType() {
            KbAclCreateRequest bad = new KbAclCreateRequest(SUBJECT_ID, "group", "read");

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> service.grant(USER_ID, LIBRARY_ID, bad));

            assertEquals(ResultCode.VALIDATION_ERROR.getCode(), ex.getCode());
            verify(aclRepository, never()).save(any(KbAcl.class));
        }

        @Test
        @DisplayName("grant 非法 action → 400 VALIDATION_ERROR")
        void grantRejectsIllegalAction() {
            KbAclCreateRequest bad = new KbAclCreateRequest(SUBJECT_ID, "user", "write");

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> service.grant(USER_ID, LIBRARY_ID, bad));

            assertEquals(ResultCode.VALIDATION_ERROR.getCode(), ex.getCode());
            verify(aclRepository, never()).save(any(KbAcl.class));
        }

        @Test
        @DisplayName("grant 已存在同款授权 → 40922 KB_ACL_EXISTS")
        void grantRejectsDuplicate() {
            when(aclRepository.existsByLibraryIdAndSubjectTypeAndSubjectIdAndAction(
                    eq(LIBRARY_ID), eq("user"), eq(SUBJECT_ID), eq("read"))).thenReturn(true);

            KbBusinessException ex = assertThrows(KbBusinessException.class,
                    () -> service.grant(USER_ID, LIBRARY_ID, readGrant()));

            assertEquals(KbResultCode.KB_ACL_EXISTS.getCode(), ex.getCode());
            verify(aclRepository, never()).save(any(KbAcl.class));
        }

        @Test
        @DisplayName("grant 库不存在 → 40410，不触碰授权表")
        void grantRejectsMissingLibrary() {
            when(libraryRepository.findById(404L)).thenReturn(Optional.empty());

            KbBusinessException ex = assertThrows(KbBusinessException.class,
                    () -> service.grant(USER_ID, 404L, readGrant()));

            assertEquals(KbResultCode.KB_LIBRARY_NOT_FOUND.getCode(), ex.getCode());
            verify(aclRepository, never()).save(any(KbAcl.class));
        }

        @Test
        @DisplayName("★ 正分支：read 授权落库，返回视图字段齐全")
        void grantReadSucceeds() {
            when(aclRepository.existsByLibraryIdAndSubjectTypeAndSubjectIdAndAction(
                    eq(LIBRARY_ID), eq("user"), eq(SUBJECT_ID), eq("read"))).thenReturn(false);
            when(aclRepository.save(any(KbAcl.class))).thenAnswer(inv -> inv.getArgument(0));

            KbAclVO vo = service.grant(USER_ID, LIBRARY_ID, readGrant());

            ArgumentCaptor<KbAcl> captor = ArgumentCaptor.forClass(KbAcl.class);
            verify(aclRepository).save(captor.capture());
            KbAcl saved = captor.getValue();
            assertEquals(LIBRARY_ID, saved.getLibraryId());
            assertEquals("user", saved.getSubjectType());
            assertEquals(SUBJECT_ID, saved.getSubjectId());
            assertEquals("read", saved.getAction());
            assertNotNull(saved.getCreatedAt());
            assertNotNull(saved.getUpdatedAt());

            assertEquals(LIBRARY_ID, vo.libraryId());
            assertEquals("user", vo.subjectType());
            assertEquals("read", vo.action());
        }
    }

    // ---------------------------------------------------------------- revoke

    @Nested
    @DisplayName("revoke：先取行再校验管辖")
    class Revoke {

        private KbAcl aclRow() {
            KbAcl a = new KbAcl();
            a.setId(ACL_ID);
            a.setLibraryId(LIBRARY_ID);
            a.setSubjectType("user");
            a.setSubjectId(SUBJECT_ID);
            a.setAction("manage");
            return a;
        }

        @Test
        @DisplayName("★ KBP-09：撤销时库不在管理范围 → 40311，行不被删")
        void revokeRejectedWhenNotManageable() {
            when(aclRepository.findById(ACL_ID)).thenReturn(Optional.of(aclRow()));
            when(nodeAdminResolver.hasLibraryManage(eq(USER_ID), eq(LIBRARY_ID))).thenReturn(false);

            KbBusinessException ex = assertThrows(KbBusinessException.class,
                    () -> service.revoke(USER_ID, ACL_ID));

            assertEquals(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE.getCode(), ex.getCode());
            verify(aclRepository, never()).delete(any(KbAcl.class));
        }

        @Test
        @DisplayName("撤销正分支：有管理权 → 删除该行")
        void revokeSucceeds() {
            when(aclRepository.findById(ACL_ID)).thenReturn(Optional.of(aclRow()));

            service.revoke(USER_ID, ACL_ID);

            verify(aclRepository).delete(any(KbAcl.class));
        }

        @Test
        @DisplayName("撤销不存在的行 → 40410")
        void revokeMissingRow() {
            when(aclRepository.findById(404L)).thenReturn(Optional.empty());

            KbBusinessException ex = assertThrows(KbBusinessException.class,
                    () -> service.revoke(USER_ID, 404L));

            assertEquals(KbResultCode.KB_LIBRARY_NOT_FOUND.getCode(), ex.getCode());
        }
    }

    // ---------------------------------------------------------------- KBP-10 只读清单

    @Nested
    @DisplayName("listLegacyInventory：KBP-10 存量只读清单")
    class LegacyInventory {

        private KbAcl legacyRow(long id, long libraryId, String subjectType, long subjectId, String action) {
            KbAcl a = new KbAcl();
            a.setId(id);
            a.setLibraryId(libraryId);
            a.setSubjectType(subjectType);
            a.setSubjectId(subjectId);
            a.setAction(action);
            return a;
        }

        @Test
        @DisplayName("★ 非全局管理员 → 40311（清单是跨库全局视角，普通管理员不可见）")
        void inventoryRejectedForNonGlobalAdmin() {
            when(nodeAdminResolver.isGlobalAdmin(USER_ID)).thenReturn(false);

            KbBusinessException ex = assertThrows(KbBusinessException.class,
                    () -> service.listLegacyInventory(USER_ID, null, null, null));

            assertEquals(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE.getCode(), ex.getCode());
            verify(aclRepository, never()).findByActionIn(any());
        }

        @Test
        @DisplayName("★ 正分支：只查 manage/acl 存量行，回填 libraryName/categoryId，subjectName 恒 null")
        void inventoryReturnsLegacyRows() {
            when(nodeAdminResolver.isGlobalAdmin(USER_ID)).thenReturn(true);
            when(aclRepository.findByActionIn(eq(List.of("manage", "acl")))).thenReturn(List.of(
                    legacyRow(1L, LIBRARY_ID, "user", SUBJECT_ID, "manage"),
                    legacyRow(2L, 200L, "role", 5L, "acl")));

            List<LegacyAclInventoryVO> rows =
                    service.listLegacyInventory(USER_ID, null, null, null);

            assertEquals(2, rows.size());
            LegacyAclInventoryVO first = rows.get(0);
            assertEquals(LIBRARY_ID, first.libraryId());
            assertEquals("员工手册", first.libraryName());
            assertEquals(CATEGORY_ID, first.categoryId());
            assertEquals("user", first.subjectType());
            assertEquals(SUBJECT_ID, first.subjectId());
            assertNull(first.subjectName(), "mis-kb 侧 subjectName 恒为 null，由 BFF 回填");
            assertEquals("manage", first.action());
        }

        @Test
        @DisplayName("过滤：libraryId / subjectType / subjectId 任一收敛")
        void inventoryFilters() {
            when(nodeAdminResolver.isGlobalAdmin(USER_ID)).thenReturn(true);
            when(aclRepository.findByActionIn(eq(List.of("manage", "acl")))).thenReturn(List.of(
                    legacyRow(1L, LIBRARY_ID, "user", SUBJECT_ID, "manage"),
                    legacyRow(2L, 200L, "role", 5L, "acl"),
                    legacyRow(3L, LIBRARY_ID, "dept", 9L, "manage")));

            // 只按库过滤
            assertEquals(2, service.listLegacyInventory(USER_ID, LIBRARY_ID, null, null).size());
            // 库 + 主体类型
            assertEquals(1, service.listLegacyInventory(USER_ID, LIBRARY_ID, "user", null).size());
            // 库 + 主体 id
            assertEquals(1, service.listLegacyInventory(USER_ID, LIBRARY_ID, null, SUBJECT_ID).size());
            // 全维度
            assertEquals(1, service.listLegacyInventory(USER_ID, LIBRARY_ID, "user", SUBJECT_ID).size());
            // 组合不命中 → 空
            assertTrue(service.listLegacyInventory(USER_ID, LIBRARY_ID, "role", 9L).isEmpty());
        }

        @Test
        @DisplayName("库已删除 → libraryName/categoryId 回落 null（不因悬空授权崩）")
        void inventoryToleratesMissingLibrary() {
            when(nodeAdminResolver.isGlobalAdmin(USER_ID)).thenReturn(true);
            when(aclRepository.findByActionIn(eq(List.of("manage", "acl")))).thenReturn(List.of(
                    legacyRow(1L, 404L, "user", SUBJECT_ID, "manage")));
            when(libraryRepository.findById(404L)).thenReturn(Optional.empty());

            List<LegacyAclInventoryVO> rows =
                    service.listLegacyInventory(USER_ID, null, null, null);

            assertEquals(1, rows.size());
            assertNull(rows.get(0).libraryName());
            assertNull(rows.get(0).categoryId());
        }

        @Test
        @DisplayName("read 授权不混入清单（只读清单只关心存量 manage/acl 行）")
        void inventoryExcludesReadRows() {
            when(nodeAdminResolver.isGlobalAdmin(USER_ID)).thenReturn(true);
            // findByActionIn 只查 manage/acl——即使库里躺着 read 行也不会返回
            when(aclRepository.findByActionIn(eq(List.of("manage", "acl")))).thenReturn(List.of(
                    legacyRow(1L, LIBRARY_ID, "user", SUBJECT_ID, "manage")));

            List<LegacyAclInventoryVO> rows =
                    service.listLegacyInventory(USER_ID, null, null, null);

            assertEquals(1, rows.size());
            assertEquals("manage", rows.get(0).action());
        }
    }
}
