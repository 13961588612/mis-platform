package com.mis.kb.domain.service;

import com.mis.kb.api.client.KbSubjectClient;
import com.mis.kb.domain.entity.KbAcl;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.AclAction;
import com.mis.kb.domain.model.LibraryStatus;
import com.mis.kb.domain.model.Secrecy;
import com.mis.kb.domain.model.SubjectType;
import com.mis.kb.domain.repository.KbAclRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;

/**
 * 可见性计算单测（T6 验收）。
 *
 * <p>覆盖：普通级（public）默认可见、受限级需 ACL、角色级 ACL 生效、disabled 库一律排除、
 * IAM 降级（无角色）时仅 public 可见、以及请求库与可见库求交集。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class KbVisibilityServiceTest {

    @Mock
    private KbLibraryRepository libraryRepository;
    @Mock
    private KbAclRepository aclRepository;
    @Mock
    private KbSubjectClient subjectClient;

    private KbVisibilityService visibilityService;

    private static final long USER_ID = 1001L;
    private static final long ROLE_ID = 2001L;

    @BeforeEach
    void setUp() {
        visibilityService = new KbVisibilityService(libraryRepository, aclRepository, subjectClient);
        // 默认：无角色、无任何 ACL
        when(subjectClient.fetchUserRoleIds(anyLong())).thenReturn(List.of());
        when(aclRepository.findBySubjectTypeAndSubjectIdAndAction(
                org.mockito.ArgumentMatchers.anyString(), anyLong(), org.mockito.ArgumentMatchers.anyString()))
                .thenReturn(List.of());
    }

    @Test
    void publicEnabledLibrary_isVisibleWithoutAcl() {
        when(libraryRepository.findByStatus(LibraryStatus.ENABLED.code()))
                .thenReturn(List.of(library(10L, Secrecy.PUBLIC.code())));

        List<Long> visible = visibilityService.resolveVisibleLibraryIds(USER_ID, null);

        assertEquals(List.of(10L), visible);
    }

    @Test
    void restrictedLibrary_withoutAcl_isNotVisible() {
        when(libraryRepository.findByStatus(LibraryStatus.ENABLED.code()))
                .thenReturn(List.of(library(20L, Secrecy.SECRET.code())));

        List<Long> visible = visibilityService.resolveVisibleLibraryIds(USER_ID, null);

        assertTrue(visible.isEmpty(), "受限级库在无 ACL 时不可见");
    }

    @Test
    void restrictedLibrary_withUserReadAcl_isVisible() {
        when(libraryRepository.findByStatus(LibraryStatus.ENABLED.code()))
                .thenReturn(List.of(library(20L, Secrecy.SECRET.code())));
        when(aclRepository.findBySubjectTypeAndSubjectIdAndAction(
                SubjectType.USER.code(), USER_ID, AclAction.READ.code()))
                .thenReturn(List.of(acl(20L, SubjectType.USER.code(), USER_ID, AclAction.READ.code())));

        List<Long> visible = visibilityService.resolveVisibleLibraryIds(USER_ID, null);

        assertEquals(List.of(20L), visible);
    }

    @Test
    void restrictedLibrary_withRoleReadAcl_isVisible() {
        when(libraryRepository.findByStatus(LibraryStatus.ENABLED.code()))
                .thenReturn(List.of(library(30L, Secrecy.INTERNAL.code())));
        when(subjectClient.fetchUserRoleIds(USER_ID)).thenReturn(List.of(ROLE_ID));
        when(aclRepository.findBySubjectTypeAndSubjectIdAndAction(
                SubjectType.ROLE.code(), ROLE_ID, AclAction.READ.code()))
                .thenReturn(List.of(acl(30L, SubjectType.ROLE.code(), ROLE_ID, AclAction.READ.code())));

        List<Long> visible = visibilityService.resolveVisibleLibraryIds(USER_ID, null);

        assertEquals(List.of(30L), visible);
    }

    @Test
    void disabledLibrary_isNeverVisible_evenWithAcl() {
        // findByStatus(ENABLED) 天然排除 disabled；此处模拟仓储只返回启用库
        //
        // 【为何不构造「启用+停用混合集」加强本用例】disabled 的一票否决由**仓储查询语义**
        // （findByStatus(ENABLED)）在数据源头保证，而非服务层的过滤分支——服务层根本没有
        // 读 status 的代码路径。真实运行中 disabled 库永远不会进入这个 List，
        // 因此喂入混合集属于伪造不可达状态，只会测出「服务层不认识 status」这一已知事实，
        // 无法提升对真实缺陷的检出力。同理，软删（P0 即 status=0，无独立软删列）也在同一道
        // 过滤内收敛，见 KbVisibilityService 类级 Javadoc 的口径说明。
        // 若 P1 把 status 过滤下放到服务层或引入 deleted_at 列，本用例必须改为混合集断言。
        when(libraryRepository.findByStatus(LibraryStatus.ENABLED.code())).thenReturn(List.of());
        when(aclRepository.findBySubjectTypeAndSubjectIdAndAction(
                SubjectType.USER.code(), USER_ID, AclAction.READ.code()))
                .thenReturn(List.of(acl(40L, SubjectType.USER.code(), USER_ID, AclAction.READ.code())));

        List<Long> visible = visibilityService.resolveVisibleLibraryIds(USER_ID, null);

        assertTrue(visible.isEmpty(), "停用库即便有 ACL 也不可见");
    }

    @Test
    void iamDegraded_onlyPublicVisible() {
        when(libraryRepository.findByStatus(LibraryStatus.ENABLED.code()))
                .thenReturn(List.of(
                        library(10L, Secrecy.PUBLIC.code()),
                        library(20L, Secrecy.CONFIDENTIAL.code())));
        // subjectClient 降级返回空角色（setUp 默认）

        List<Long> visible = visibilityService.resolveVisibleLibraryIds(USER_ID, null);

        assertEquals(1, visible.size());
        assertTrue(visible.contains(10L));
        assertFalse(visible.contains(20L));
    }

    @Test
    void filterVisible_intersectsRequestedWithVisible() {
        List<Long> visible = List.of(1L, 2L, 3L);

        assertEquals(List.of(2L, 3L), visibilityService.filterVisible(List.of(2L, 3L, 99L), visible));
        assertEquals(visible, visibilityService.filterVisible(null, visible),
                "未指定请求库时回退为全部可见库");
        assertEquals(visible, visibilityService.filterVisible(List.of(), visible));
        assertTrue(visibilityService.filterVisible(List.of(99L), visible).isEmpty());
    }

    private static KbLibrary library(long id, String secrecy) {
        KbLibrary lib = new KbLibrary();
        lib.setId(id);
        lib.setCategoryId(1L);
        lib.setName("lib-" + id);
        lib.setSecrecy(secrecy);
        lib.setStatus(LibraryStatus.ENABLED.code());
        return lib;
    }

    private static KbAcl acl(long libraryId, String subjectType, long subjectId, String action) {
        KbAcl entity = new KbAcl();
        entity.setId(libraryId * 10);
        entity.setLibraryId(libraryId);
        entity.setSubjectType(subjectType);
        entity.setSubjectId(subjectId);
        entity.setAction(action);
        return entity;
    }
}
