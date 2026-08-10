package com.mis.kb.domain.service;

import com.mis.kb.api.dto.KbCategoryCreateRequest;
import com.mis.kb.api.dto.KbCategoryUpdateRequest;
import com.mis.kb.api.dto.KbCategoryVO;
import com.mis.kb.domain.entity.KbCategory;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.repository.KbCategoryRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.support.KbBusinessException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link KbCategoryService} 管辖校验接入后 create/update/delete/move 行为单测
 * （知识库域一期，T03）。
 *
 * <p>管辖判定收口在 {@link NodeAdminResolver}（本测试 mock 之），Service 只负责编排与
 * 业务码透传；纯 Mockito 零 Spring 上下文。
 */
class KbCategoryServiceManageTest {

    private static final long USER = 10L;
    private static final long PARENT = 1L;
    private static final long NODE = 2L;

    private KbCategoryRepository categoryRepository;
    private KbLibraryRepository libraryRepository;
    private NodeAdminResolver nodeAdminResolver;
    private KbCategoryService service;

    @BeforeEach
    void setUp() {
        categoryRepository = mock(KbCategoryRepository.class);
        libraryRepository = mock(KbLibraryRepository.class);
        nodeAdminResolver = mock(NodeAdminResolver.class);
        service = new KbCategoryService(categoryRepository, libraryRepository, nodeAdminResolver);

        KbCategory node = category(NODE, PARENT);
        when(categoryRepository.findById(NODE)).thenReturn(Optional.of(node));
        // save 恒返回入参（identity），使 toVo(entity) 拿到非空实体；仅做落库编排验证
        when(categoryRepository.save(any(KbCategory.class))).thenAnswer(inv -> inv.getArgument(0));
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

    // ---------------------------------------------------------------- create

    @Test
    @DisplayName("create：子节点须能管其父节点；通过后落库")
    void createRequiresParentManage() {
        KbCategoryCreateRequest req = new KbCategoryCreateRequest("新分类", PARENT, 1, 0, null);
        when(categoryRepository.save(any(KbCategory.class))).thenAnswer(inv -> inv.getArgument(0));

        KbCategoryVO vo = service.create(req, USER);

        assertNotNull(vo);
        assertEquals(PARENT, vo.parentId());
        assertEquals("新分类", vo.name());
        verify(nodeAdminResolver).assertNodeManage(USER, PARENT);
    }

    @Test
    @DisplayName("create：父节点管辖外 → 40311")
    void createRejectsOutOfScopeParent() {
        KbCategoryCreateRequest req = new KbCategoryCreateRequest("新分类", PARENT, 1, 0, null);
        doThrow(new KbBusinessException(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE))
                .when(nodeAdminResolver).assertNodeManage(USER, PARENT);

        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> service.create(req, USER));
        assertEquals(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE.getCode(), ex.getCode());
        verify(categoryRepository, never()).save(any());
    }

    @Test
    @DisplayName("create：根节点须全局管理员；非全局 → 40311")
    void createRootRequiresGlobalAdmin() {
        KbCategoryCreateRequest req = new KbCategoryCreateRequest("根分类", null, 1, 0, null);
        when(nodeAdminResolver.isGlobalAdmin(USER)).thenReturn(false);

        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> service.create(req, USER));
        assertEquals(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE.getCode(), ex.getCode());
        verify(categoryRepository, never()).save(any());
    }

    @Test
    @DisplayName("create：根节点 + 全局管理员 → 放行")
    void createRootByGlobalAdmin() {
        KbCategoryCreateRequest req = new KbCategoryCreateRequest("根分类", null, 1, 0, null);
        when(nodeAdminResolver.isGlobalAdmin(USER)).thenReturn(true);
        when(categoryRepository.save(any(KbCategory.class))).thenAnswer(inv -> inv.getArgument(0));

        KbCategoryVO vo = service.create(req, USER);

        assertNotNull(vo);
        assertEquals(null, vo.parentId());
    }

    // ---------------------------------------------------------------- update

    @Test
    @DisplayName("update：须能管该节点；通过后改名落库")
    void updateRequiresNodeManage() {
        KbCategoryUpdateRequest req = new KbCategoryUpdateRequest("改名", 1, 1, null);

        KbCategoryVO vo = service.update(NODE, req, USER);

        assertEquals("改名", vo.name());
        verify(nodeAdminResolver).assertNodeManage(USER, NODE);
    }

    @Test
    @DisplayName("update：管辖外 → 40311")
    void updateRejectsOutOfScope() {
        KbCategoryUpdateRequest req = new KbCategoryUpdateRequest("改名", 1, 1, null);
        doThrow(new KbBusinessException(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE))
                .when(nodeAdminResolver).assertNodeManage(USER, NODE);

        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> service.update(NODE, req, USER));
        assertEquals(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE.getCode(), ex.getCode());
    }

    // ---------------------------------------------------------------- delete

    @Test
    @DisplayName("delete：管辖外 → 40311（先于子树/引用校验）")
    void deleteRejectsOutOfScope() {
        doThrow(new KbBusinessException(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE))
                .when(nodeAdminResolver).assertNodeManage(USER, NODE);

        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> service.delete(NODE, USER));
        assertEquals(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE.getCode(), ex.getCode());
        verify(categoryRepository, never()).existsByParentId(any());
    }

    @Test
    @DisplayName("delete：管辖内但存在子分类/库引用 → 沿用 40921（KB_CATEGORY_HAS_CHILDREN）")
    void deleteKeepsChildrenCheck() {
        when(categoryRepository.existsByParentId(NODE)).thenReturn(true);

        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> service.delete(NODE, USER));
        assertEquals(KbResultCode.KB_CATEGORY_HAS_CHILDREN.getCode(), ex.getCode());
        verify(categoryRepository, never()).delete(any());
    }

    // ---------------------------------------------------------------- move

    @Test
    @DisplayName("move：assertCanMove 通过 → 更新 parentId 落库")
    void moveUpdatesParent() {
        KbCategoryVO vo = service.move(NODE, 5L, USER);

        assertEquals(5L, vo.parentId());
        verify(nodeAdminResolver).assertCanMove(USER, NODE, 5L);
    }

    @Test
    @DisplayName("move：目标越权 → 40312（MOVE_OUT_OF_SCOPE）透传")
    void moveRejectsOutOfScope() {
        doThrow(new KbBusinessException(KbResultCode.KB_CATEGORY_MOVE_OUT_OF_SCOPE))
                .when(nodeAdminResolver).assertCanMove(USER, NODE, 5L);

        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> service.move(NODE, 5L, USER));
        assertEquals(KbResultCode.KB_CATEGORY_MOVE_OUT_OF_SCOPE.getCode(), ex.getCode());
    }

    @Test
    @DisplayName("move：目标为自身后代 → 40933（MOVE_CYCLE）透传")
    void moveRejectsCycle() {
        doThrow(new KbBusinessException(KbResultCode.KB_CATEGORY_MOVE_CYCLE))
                .when(nodeAdminResolver).assertCanMove(USER, NODE, 3L);

        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> service.move(NODE, 3L, USER));
        assertEquals(KbResultCode.KB_CATEGORY_MOVE_CYCLE.getCode(), ex.getCode());
    }
}
