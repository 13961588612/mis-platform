package com.mis.org.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.org.domain.entity.SysPostType;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.domain.repository.SysEmployeePostRepository;
import com.mis.org.domain.repository.SysPostRepository;
import com.mis.org.domain.repository.SysPostTypeRepository;
import com.mis.org.dto.PostTypeCreateRequest;
import com.mis.org.dto.PostTypeUpdateRequest;
import com.mis.org.dto.PostTypeVO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 岗位类型 isLeaf 显式字段规则：不推导；仅非末级可挂子；有子不可改末级；有引用不可改分类。
 */
@ExtendWith(MockitoExtension.class)
class PostServicePostTypeLeafTest {

    private static final Long TENANT = 1L;

    @Mock private SysPostRepository postRepository;
    @Mock private SysPostTypeRepository postTypeRepository;
    @Mock private SysEmployeePostRepository employeePostRepository;
    @Mock private SysDeptRepository deptRepository;

    private PostService postService;

    @BeforeEach
    void setUp() {
        postService = new PostService(postRepository, postTypeRepository, employeePostRepository, deptRepository);
    }

    private static SysPostType type(Long id, Long parentId, int isLeaf) {
        SysPostType t = new SysPostType();
        t.setId(id);
        t.setTenantId(TENANT);
        t.setCode("C" + id);
        t.setName("N" + id);
        t.setSort(0);
        t.setStatus(1);
        t.setParentId(parentId);
        t.setIsLeaf(isLeaf);
        t.setCreatedAt(Instant.now());
        t.setUpdatedAt(Instant.now());
        return t;
    }

    @Test
    @DisplayName("挂到末级父节点 → 拒绝")
    void createUnderLeafParentRejected() {
        when(postTypeRepository.findByTenantIdAndCode(TENANT, "x")).thenReturn(Optional.empty());
        when(postTypeRepository.findById(10L)).thenReturn(Optional.of(type(10L, 0L, 1)));

        PostTypeCreateRequest req = new PostTypeCreateRequest(TENANT, "x", "子", 0, 1, 10L, 1);
        BusinessException ex = assertThrows(BusinessException.class, () -> postService.createType(req));
        assertEquals("仅非末级（分类）类型下可增加子类型", ex.getMessage());
        verify(postTypeRepository, never()).save(any());
    }

    @Test
    @DisplayName("挂到非末级父节点 + 显式 isLeaf=1 → 成功且不回写父 isLeaf")
    void createUnderNonLeafParentOk() {
        when(postTypeRepository.findByTenantIdAndCode(TENANT, "x")).thenReturn(Optional.empty());
        when(postTypeRepository.findById(10L)).thenReturn(Optional.of(type(10L, 0L, 0)));
        when(postTypeRepository.save(any(SysPostType.class))).thenAnswer(inv -> inv.getArgument(0));

        PostTypeCreateRequest req = new PostTypeCreateRequest(TENANT, "x", "子", 0, 1, 10L, 1);
        PostTypeVO vo = postService.createType(req);
        assertEquals(1, vo.isLeaf());
        assertEquals("10", vo.parentId());

        ArgumentCaptor<SysPostType> cap = ArgumentCaptor.forClass(SysPostType.class);
        verify(postTypeRepository).save(cap.capture());
        assertEquals(1, cap.getValue().getIsLeaf());
        assertEquals(10L, cap.getValue().getParentId());
        // 父节点不再被 refreshLeaf 回写
        verify(postTypeRepository).findById(10L);
    }

    @Test
    @DisplayName("创建时显式 isLeaf=0 → 写入分类")
    void createExplicitNonLeaf() {
        when(postTypeRepository.findByTenantIdAndCode(TENANT, "cat")).thenReturn(Optional.empty());
        when(postTypeRepository.save(any(SysPostType.class))).thenAnswer(inv -> inv.getArgument(0));

        PostTypeCreateRequest req = new PostTypeCreateRequest(TENANT, "cat", "分类", 0, 1, 0L, 0);
        PostTypeVO vo = postService.createType(req);
        assertEquals(0, vo.isLeaf());
    }

    @Test
    @DisplayName("有子时改 isLeaf=1 → 拒绝")
    void markLeafWithChildrenRejected() {
        SysPostType self = type(10L, 0L, 0);
        when(postTypeRepository.findById(10L)).thenReturn(Optional.of(self));
        when(postTypeRepository.existsByTenantIdAndParentId(TENANT, 10L)).thenReturn(true);

        PostTypeUpdateRequest req = new PostTypeUpdateRequest("分类", 0, 1, null, 1);
        BusinessException ex = assertThrows(BusinessException.class, () -> postService.updateType(10L, req));
        assertEquals("存在子类型时不可标记为末级，请先删除或移走子类型", ex.getMessage());
    }

    @Test
    @DisplayName("有岗位引用时改 isLeaf=0 → 拒绝")
    void markNonLeafWithRefsRejected() {
        SysPostType self = type(10L, 0L, 1);
        when(postTypeRepository.findById(10L)).thenReturn(Optional.of(self));
        when(postRepository.countByPostTypeId(10L)).thenReturn(2L);

        PostTypeUpdateRequest req = new PostTypeUpdateRequest("类型", 0, 1, null, 0);
        BusinessException ex = assertThrows(BusinessException.class, () -> postService.updateType(10L, req));
        assertEquals("已被岗位引用的类型不可改为非末级（分类）", ex.getMessage());
    }

    @Test
    @DisplayName("删除末级不回写父 isLeaf")
    void deleteLeafDoesNotRefreshParent() {
        SysPostType self = type(11L, 10L, 1);
        when(postTypeRepository.findById(11L)).thenReturn(Optional.of(self));
        when(postTypeRepository.existsByTenantIdAndParentId(TENANT, 11L)).thenReturn(false);
        when(postRepository.countByPostTypeId(11L)).thenReturn(0L);

        postService.deleteType(11L);
        verify(postTypeRepository).delete(self);
        verify(postTypeRepository, never()).save(any());
    }
}
