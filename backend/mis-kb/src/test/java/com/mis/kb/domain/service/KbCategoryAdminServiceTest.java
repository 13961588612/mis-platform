package com.mis.kb.domain.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.kb.api.dto.KbCategoryAdminCreateRequest;
import com.mis.kb.api.dto.KbCategoryAdminVO;
import com.mis.kb.domain.entity.KbCategory;
import com.mis.kb.domain.entity.KbCategoryAdmin;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.repository.KbCategoryAdminRepository;
import com.mis.kb.domain.repository.KbCategoryRepository;
import com.mis.kb.support.KbBusinessException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link KbCategoryAdminService} 授权 CRUD 单测（知识库域一期）。
 *
 * <p>覆盖：grant 去重（40932）、非法主体拒绝、revoke 前置管辖校验（40311）、
 * 授权行不存在（40400）、级联删除由 FK 承担（服务不拦截）。
 * 纯 Mockito 零 Spring 上下文。
 */
class KbCategoryAdminServiceTest {

    private static final long CATEGORY = 2L;
    private static final long USER = 10L;

    private KbCategoryAdminRepository adminRepository;
    private KbCategoryRepository categoryRepository;
    private NodeAdminResolver nodeAdminResolver;
    private KbCategoryAdminService service;

    @BeforeEach
    void setUp() {
        adminRepository = mock(KbCategoryAdminRepository.class);
        categoryRepository = mock(KbCategoryRepository.class);
        nodeAdminResolver = mock(NodeAdminResolver.class);
        service = new KbCategoryAdminService(adminRepository, categoryRepository, nodeAdminResolver);

        KbCategory category = new KbCategory();
        category.setId(CATEGORY);
        category.setName("分类");
        when(categoryRepository.findById(CATEGORY)).thenReturn(Optional.of(category));
    }

    // ---------------------------------------------------------------- list

    @Test
    @DisplayName("list：管理权通过后返回该节点全部授权行")
    void listReturnsRows() {
        when(adminRepository.findByCategoryId(CATEGORY))
                .thenReturn(List.of(adminRow(1L, CATEGORY, "user", 5L, USER)));

        List<KbCategoryAdminVO> rows = service.list(CATEGORY, USER);

        assertEquals(1, rows.size());
        assertEquals(CATEGORY, rows.get(0).categoryId());
        assertEquals("user", rows.get(0).subjectType());
        assertEquals(5L, rows.get(0).subjectId());
        assertEquals(USER, rows.get(0).createdBy());
        verify(nodeAdminResolver).assertNodeManage(USER, CATEGORY);
    }

    @Test
    @DisplayName("list：节点不存在抛 40412")
    void listCategoryNotFound() {
        when(categoryRepository.findById(404L)).thenReturn(Optional.empty());

        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> service.list(404L, USER));
        assertEquals(KbResultCode.KB_CATEGORY_NOT_FOUND.getCode(), ex.getCode());
    }

    // ---------------------------------------------------------------- grant

    @Test
    @DisplayName("grant：通过管辖校验 + UK 去重后落库，createdBy=当前用户")
    void grantSavesWithCreator() {
        KbCategoryAdminCreateRequest req = new KbCategoryAdminCreateRequest("role", 100L);
        when(adminRepository.existsByCategoryIdAndSubjectTypeAndSubjectId(CATEGORY, "role", 100L))
                .thenReturn(false);
        when(adminRepository.save(any(KbCategoryAdmin.class))).thenAnswer(inv -> inv.getArgument(0));

        KbCategoryAdminVO vo = service.grant(CATEGORY, req, USER);

        assertNotNull(vo);
        assertEquals(CATEGORY, vo.categoryId());
        assertEquals("role", vo.subjectType());
        assertEquals(100L, vo.subjectId());
        assertEquals(USER, vo.createdBy());
        verify(nodeAdminResolver).assertNodeManage(USER, CATEGORY);
    }

    @Test
    @DisplayName("grant：同节点同主体重复授权抛 40932（KB_CATEGORY_ADMIN_EXISTS）")
    void grantRejectsDuplicate() {
        KbCategoryAdminCreateRequest req = new KbCategoryAdminCreateRequest("user", 5L);
        when(adminRepository.existsByCategoryIdAndSubjectTypeAndSubjectId(CATEGORY, "user", 5L))
                .thenReturn(true);

        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> service.grant(CATEGORY, req, USER));
        assertEquals(KbResultCode.KB_CATEGORY_ADMIN_EXISTS.getCode(), ex.getCode());
        verify(adminRepository, never()).save(any());
    }

    @Test
    @DisplayName("grant：非法主体类型抛校验错误")
    void grantRejectsInvalidSubjectType() {
        KbCategoryAdminCreateRequest req = new KbCategoryAdminCreateRequest("group", 5L);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.grant(CATEGORY, req, USER));
        assertEquals(ResultCode.VALIDATION_ERROR.getCode(), ex.getCode());
        verify(adminRepository, never()).save(any());
    }

    @Test
    @DisplayName("grant：设置者无权管该节点 → 40311 且不落库")
    void grantRequiresManage() {
        org.mockito.Mockito.doThrow(new KbBusinessException(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE))
                .when(nodeAdminResolver).assertNodeManage(USER, CATEGORY);

        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> service.grant(CATEGORY, new KbCategoryAdminCreateRequest("user", 5L), USER));
        assertEquals(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE.getCode(), ex.getCode());
        verify(adminRepository, never()).save(any());
    }

    // ---------------------------------------------------------------- revoke

    @Test
    @DisplayName("revoke：回收者管该节点后删除授权行（O-1：子目录保留仅失权）")
    void revokeDeletesRow() {
        KbCategoryAdmin row = adminRow(9L, CATEGORY, "user", 5L, USER);
        when(adminRepository.findById(9L)).thenReturn(Optional.of(row));

        service.revoke(9L, USER);

        verify(nodeAdminResolver).assertNodeManage(USER, CATEGORY);
        verify(adminRepository).delete(row);
    }

    @Test
    @DisplayName("revoke：授权行不存在抛 40400（NOT_FOUND）")
    void revokeNotFound() {
        when(adminRepository.findById(404L)).thenReturn(Optional.empty());

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.revoke(404L, USER));
        assertEquals(ResultCode.NOT_FOUND.getCode(), ex.getCode());
        verify(nodeAdminResolver, never()).assertNodeManage(any(), any());
    }

    @Test
    @DisplayName("revoke：回收者无权管该节点 → 40311 且不删除")
    void revokeRequiresManage() {
        KbCategoryAdmin row = adminRow(9L, CATEGORY, "user", 5L, USER);
        when(adminRepository.findById(9L)).thenReturn(Optional.of(row));
        org.mockito.Mockito.doThrow(new KbBusinessException(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE))
                .when(nodeAdminResolver).assertNodeManage(USER, CATEGORY);

        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> service.revoke(9L, USER));
        assertEquals(KbResultCode.KB_CATEGORY_NOT_MANAGEABLE.getCode(), ex.getCode());
        verify(adminRepository, never()).delete(any());
    }

    // ---------------------------------------------------------------- 辅助

    private static KbCategoryAdmin adminRow(long id, long categoryId, String type, long subjectId, long createdBy) {
        KbCategoryAdmin a = new KbCategoryAdmin();
        a.setId(id);
        a.setCategoryId(categoryId);
        a.setSubjectType(type);
        a.setSubjectId(subjectId);
        a.setCreatedBy(createdBy);
        return a;
    }
}
