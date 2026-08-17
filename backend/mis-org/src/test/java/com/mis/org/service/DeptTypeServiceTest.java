package com.mis.org.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.org.domain.entity.SysDeptType;
import com.mis.org.domain.repository.SysDeptRepository;
import com.mis.org.domain.repository.SysDeptTypeRepository;
import com.mis.org.dto.DeptTypeCreateRequest;
import com.mis.org.dto.DeptTypeTreeNodeVO;
import com.mis.org.dto.DeptTypeUpdateRequest;
import com.mis.org.dto.DeptTypeVO;
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
 * DeptTypeService 单元测试（纯 Mockito，不启动 Spring）。
 *
 * <p>覆盖：树构建 / 防自环 / 防误删 / 叶子·父级约束 等边界逻辑。
 * 风格镜像 {@link PostServicePostTypeLeafTest}。
 */
@ExtendWith(MockitoExtension.class)
class DeptTypeServiceTest {

    private static final Long TENANT = 1L;

    @Mock private SysDeptTypeRepository deptTypeRepository;
    @Mock private SysDeptRepository deptRepository;

    private DeptTypeService deptTypeService;

    @BeforeEach
    void setUp() {
        deptTypeService = new DeptTypeService(deptTypeRepository, deptRepository);
    }

    // ------------------------------------------------------------------------
    // 辅助工厂
    // ------------------------------------------------------------------------

    private static SysDeptType type(Long id, Long parentId, int isLeaf) {
        return typeWithSort(id, TENANT, parentId, isLeaf, 0);
    }

    private static SysDeptType typeWithTenant(Long id, Long tenantId, Long parentId, int isLeaf) {
        return typeWithSort(id, tenantId, parentId, isLeaf, 0);
    }

    private static SysDeptType typeWithSort(Long id, Long tenantId, Long parentId, int isLeaf, int sort) {
        SysDeptType t = new SysDeptType();
        t.setId(id);
        t.setTenantId(tenantId);
        t.setCode("C" + id);
        t.setName("N" + id);
        t.setSort(sort);
        t.setStatus(1);
        t.setParentId(parentId);
        t.setIsLeaf(isLeaf);
        t.setCreatedAt(Instant.now());
        t.setUpdatedAt(Instant.now());
        return t;
    }

    // ------------------------------------------------------------------------
    // A. 树构建 (listTypeTree / listTypes)
    // ------------------------------------------------------------------------

    @Test
    @DisplayName("A1. listTypeTree 多级嵌套正确：根 1 个，子节点按 sort 升序，parentId/isLeaf 正确")
    void listTypeTreeNested() {
        SysDeptType root = typeWithSort(1001L, TENANT, 0L, 0, 1);
        SysDeptType childA = typeWithSort(1002L, TENANT, 1001L, 1, 1);
        SysDeptType childB = typeWithSort(1003L, TENANT, 1001L, 1, 2);
        when(deptTypeRepository.findByTenantId(TENANT)).thenReturn(List.of(root, childA, childB));

        List<DeptTypeTreeNodeVO> tree = deptTypeService.listTypeTree(TENANT, null);

        assertEquals(1, tree.size());
        DeptTypeTreeNodeVO rootNode = tree.get(0);
        assertEquals("1001", rootNode.id());
        assertEquals(0, rootNode.isLeaf());
        assertEquals("0", rootNode.parentId());

        List<DeptTypeTreeNodeVO> children = rootNode.children();
        assertEquals(2, children.size());
        assertEquals("1002", children.get(0).id());
        assertEquals("1003", children.get(1).id());
        for (DeptTypeTreeNodeVO c : children) {
            assertEquals("1001", c.parentId());
            assertEquals(1, c.isLeaf());
        }
    }

    @Test
    @DisplayName("A2. listTypeTree 子节点按 sort 升序（交换 sort 验证排序）")
    void listTypeTreeSortOrder() {
        SysDeptType root = typeWithSort(1001L, TENANT, 0L, 0, 1);
        // sort 交换：1002->2，1003->1，期望排序后 [1003, 1002]
        SysDeptType childA = typeWithSort(1002L, TENANT, 1001L, 1, 2);
        SysDeptType childB = typeWithSort(1003L, TENANT, 1001L, 1, 1);
        when(deptTypeRepository.findByTenantId(TENANT)).thenReturn(List.of(root, childA, childB));

        List<DeptTypeTreeNodeVO> tree = deptTypeService.listTypeTree(TENANT, null);

        List<DeptTypeTreeNodeVO> children = tree.get(0).children();
        assertEquals(2, children.size());
        assertEquals("1003", children.get(0).id());
        assertEquals("1002", children.get(1).id());
    }

    @Test
    @DisplayName("A3. listTypes referenceCount 正确：countByDeptTypeId 逐节点映射")
    void listTypesReferenceCount() {
        SysDeptType t1 = type(1001L, 0L, 0);
        SysDeptType t2 = type(1002L, 1001L, 1);
        SysDeptType t3 = type(1003L, 1001L, 1);
        when(deptTypeRepository.findByTenantId(TENANT)).thenReturn(List.of(t1, t2, t3));
        when(deptRepository.countByDeptTypeId(1001L)).thenReturn(0L);
        when(deptRepository.countByDeptTypeId(1002L)).thenReturn(3L);
        when(deptRepository.countByDeptTypeId(1003L)).thenReturn(0L);

        List<DeptTypeVO> vos = deptTypeService.listTypes(TENANT, null);

        assertEquals(3, vos.size());
        DeptTypeVO vo1002 = vos.stream()
                .filter(v -> "1002".equals(v.id()))
                .findFirst()
                .orElseThrow();
        assertEquals(3, vo1002.referenceCount());

        DeptTypeVO vo1001 = vos.stream().filter(v -> "1001".equals(v.id())).findFirst().orElseThrow();
        assertEquals(0, vo1001.referenceCount());
    }

    @Test
    @DisplayName("A4. listTypes / listTypeTree 空数据返回 List.of()（isEmpty）")
    void listEmptyReturnsEmptyList() {
        when(deptTypeRepository.findByTenantId(TENANT)).thenReturn(List.of());
        when(deptTypeRepository.findByTenantIdAndStatus(TENANT, 1)).thenReturn(List.of());

        List<DeptTypeVO> vos = deptTypeService.listTypes(TENANT, null);
        List<DeptTypeTreeNodeVO> tree = deptTypeService.listTypeTree(TENANT, 1);

        assertEquals(true, vos.isEmpty());
        assertEquals(true, tree.isEmpty());
    }

    // ------------------------------------------------------------------------
    // B. 防环 (updateType)
    // ------------------------------------------------------------------------

    @Test
    @DisplayName("B5. updateType 挂载到自身 → 拒绝")
    void updateMountToSelfRejected() {
        when(deptTypeRepository.findById(1L)).thenReturn(Optional.of(type(1L, 0L, 0)));

        DeptTypeUpdateRequest req = new DeptTypeUpdateRequest("x", 0, 1, 1L, null);
        BusinessException ex = assertThrows(BusinessException.class, () -> deptTypeService.updateType(1L, req));
        assertEquals("部门类型不能挂载到自身", ex.getMessage());
        verify(deptTypeRepository, never()).save(any());
    }

    @Test
    @DisplayName("B6. updateType 挂载到自身下级（环）→ 拒绝")
    void updateMountToDescendantRejected() {
        SysDeptType a = type(1L, 0L, 0);
        SysDeptType b = type(2L, 1L, 0);
        SysDeptType c = type(3L, 2L, 1);
        when(deptTypeRepository.findById(1L)).thenReturn(Optional.of(a));
        // isDescendant 内部按 tenant 拉全量树做 DFS 判定
        when(deptTypeRepository.findByTenantId(TENANT)).thenReturn(List.of(a, b, c));

        DeptTypeUpdateRequest req = new DeptTypeUpdateRequest("x", 0, 1, 3L, null);
        BusinessException ex = assertThrows(BusinessException.class, () -> deptTypeService.updateType(1L, req));
        assertEquals("不能挂载到自身的下级类型（防循环）", ex.getMessage());
        verify(deptTypeRepository, never()).save(any());
    }

    // ------------------------------------------------------------------------
    // C. 防误删 (deleteType)
    // ------------------------------------------------------------------------

    @Test
    @DisplayName("C7. deleteType 非末级不可删")
    void deleteNonLeafRejected() {
        when(deptTypeRepository.findById(1001L)).thenReturn(Optional.of(type(1001L, 0L, 0)));

        BusinessException ex = assertThrows(BusinessException.class, () -> deptTypeService.deleteType(1001L));
        assertEquals("非末级类型不可删除；请先改为末级，或先处理其子类型", ex.getMessage());
        verify(deptTypeRepository, never()).delete(any());
    }

    @Test
    @DisplayName("C8. deleteType 末级但有子类型不可删")
    void deleteWithChildrenRejected() {
        SysDeptType self = type(1001L, 0L, 1);
        when(deptTypeRepository.findById(1001L)).thenReturn(Optional.of(self));
        when(deptTypeRepository.existsByTenantIdAndParentId(TENANT, 1001L)).thenReturn(true);

        BusinessException ex = assertThrows(BusinessException.class, () -> deptTypeService.deleteType(1001L));
        assertEquals("仍存在子类型，不可删除", ex.getMessage());
        verify(deptTypeRepository, never()).delete(any());
    }

    @Test
    @DisplayName("C9. deleteType 被部门引用不可删（BusinessException 409）")
    void deleteWithRefsRejected() {
        SysDeptType self = type(1001L, 0L, 1);
        when(deptTypeRepository.findById(1001L)).thenReturn(Optional.of(self));
        when(deptTypeRepository.existsByTenantIdAndParentId(TENANT, 1001L)).thenReturn(false);
        when(deptRepository.countByDeptTypeId(1001L)).thenReturn(2L);

        BusinessException ex = assertThrows(BusinessException.class, () -> deptTypeService.deleteType(1001L));
        assertEquals(409, ex.getCode());
        assertEquals("部门类型已被 2 个部门引用，禁止删除", ex.getMessage());
        verify(deptTypeRepository, never()).delete(any());
    }

    @Test
    @DisplayName("C10. deleteType 末级无子无引用可删")
    void deleteLeafOk() {
        SysDeptType self = type(1001L, 0L, 1);
        when(deptTypeRepository.findById(1001L)).thenReturn(Optional.of(self));
        when(deptTypeRepository.existsByTenantIdAndParentId(TENANT, 1001L)).thenReturn(false);
        when(deptRepository.countByDeptTypeId(1001L)).thenReturn(0L);

        deptTypeService.deleteType(1001L);
        verify(deptTypeRepository).delete(self);
        verify(deptTypeRepository, never()).save(any());
    }

    @Test
    @DisplayName("C11. deleteType 删除不存在 → NOT_FOUND")
    void deleteNotFound() {
        when(deptTypeRepository.findById(999L)).thenReturn(Optional.empty());

        BusinessException ex = assertThrows(BusinessException.class, () -> deptTypeService.deleteType(999L));
        assertEquals(ResultCode.NOT_FOUND.getCode(), ex.getCode());
        assertEquals("部门类型不存在", ex.getMessage());
        verify(deptTypeRepository, never()).delete(any());
    }

    // ------------------------------------------------------------------------
    // D. 叶子 / 父级约束 (createType / updateType)
    // ------------------------------------------------------------------------

    @Test
    @DisplayName("D12. createType 挂到末级父 → 拒绝")
    void createUnderLeafParentRejected() {
        when(deptTypeRepository.findByTenantIdAndCode(TENANT, "x")).thenReturn(Optional.empty());
        when(deptTypeRepository.findById(10L)).thenReturn(Optional.of(type(10L, 0L, 1)));

        DeptTypeCreateRequest req = new DeptTypeCreateRequest(TENANT, "x", "子", 0, 1, 10L, 1);
        BusinessException ex = assertThrows(BusinessException.class, () -> deptTypeService.createType(req));
        assertEquals("仅非末级（分类）类型下可增加子类型", ex.getMessage());
        verify(deptTypeRepository, never()).save(any());
    }

    @Test
    @DisplayName("D13. createType 挂到非末级父 + isLeaf=1 → 成功并落库")
    void createUnderNonLeafParentOk() {
        when(deptTypeRepository.findByTenantIdAndCode(TENANT, "x")).thenReturn(Optional.empty());
        when(deptTypeRepository.findById(10L)).thenReturn(Optional.of(type(10L, 0L, 0)));
        when(deptTypeRepository.save(any(SysDeptType.class))).thenAnswer(inv -> inv.getArgument(0));

        DeptTypeCreateRequest req = new DeptTypeCreateRequest(TENANT, "x", "子", 0, 1, 10L, 1);
        DeptTypeVO vo = deptTypeService.createType(req);
        assertEquals(1, vo.isLeaf());
        assertEquals("10", vo.parentId());

        ArgumentCaptor<SysDeptType> cap = ArgumentCaptor.forClass(SysDeptType.class);
        verify(deptTypeRepository).save(cap.capture());
        assertEquals(1, cap.getValue().getIsLeaf());
        assertEquals(10L, cap.getValue().getParentId());
    }

    @Test
    @DisplayName("D14. createType 显式 isLeaf=0 → 写入分类")
    void createExplicitNonLeaf() {
        when(deptTypeRepository.findByTenantIdAndCode(TENANT, "cat")).thenReturn(Optional.empty());
        when(deptTypeRepository.save(any(SysDeptType.class))).thenAnswer(inv -> inv.getArgument(0));

        DeptTypeCreateRequest req = new DeptTypeCreateRequest(TENANT, "cat", "分类", 0, 1, 0L, 0);
        DeptTypeVO vo = deptTypeService.createType(req);
        assertEquals(0, vo.isLeaf());
    }

    @Test
    @DisplayName("D15. createType code 重复 → 拒绝")
    void createDuplicateCodeRejected() {
        when(deptTypeRepository.findByTenantIdAndCode(TENANT, "x"))
                .thenReturn(Optional.of(type(100L, 0L, 1)));

        DeptTypeCreateRequest req = new DeptTypeCreateRequest(TENANT, "x", "子", 0, 1, 0L, 1);
        BusinessException ex = assertThrows(BusinessException.class, () -> deptTypeService.createType(req));
        assertEquals("部门类型编码已存在", ex.getMessage());
        verify(deptTypeRepository, never()).save(any());
    }

    @Test
    @DisplayName("D16. createType isLeaf=2（非法）→ 拒绝")
    void createInvalidIsLeafRejected() {
        when(deptTypeRepository.findByTenantIdAndCode(TENANT, "x")).thenReturn(Optional.empty());

        DeptTypeCreateRequest req = new DeptTypeCreateRequest(TENANT, "x", "子", 0, 1, 0L, 2);
        BusinessException ex = assertThrows(BusinessException.class, () -> deptTypeService.createType(req));
        assertEquals("isLeaf 仅允许 0 或 1", ex.getMessage());
        verify(deptTypeRepository, never()).save(any());
    }

    @Test
    @DisplayName("D17. updateType 有子时改 isLeaf=1 → 拒绝")
    void updateMarkLeafWithChildrenRejected() {
        SysDeptType self = type(10L, 0L, 0);
        when(deptTypeRepository.findById(10L)).thenReturn(Optional.of(self));
        when(deptTypeRepository.existsByTenantIdAndParentId(TENANT, 10L)).thenReturn(true);

        DeptTypeUpdateRequest req = new DeptTypeUpdateRequest("分类", 0, 1, null, 1);
        BusinessException ex = assertThrows(BusinessException.class, () -> deptTypeService.updateType(10L, req));
        assertEquals("存在子类型时不可标记为末级，请先删除或移走子类型", ex.getMessage());
        verify(deptTypeRepository, never()).save(any());
    }

    @Test
    @DisplayName("D18. updateType 有引用时改 isLeaf=0 → 拒绝")
    void updateMarkNonLeafWithRefsRejected() {
        SysDeptType self = type(10L, 0L, 1);
        when(deptTypeRepository.findById(10L)).thenReturn(Optional.of(self));
        when(deptRepository.countByDeptTypeId(10L)).thenReturn(2L);

        DeptTypeUpdateRequest req = new DeptTypeUpdateRequest("类型", 0, 1, null, 0);
        BusinessException ex = assertThrows(BusinessException.class, () -> deptTypeService.updateType(10L, req));
        assertEquals("已被部门引用的类型不可改为非末级（分类）", ex.getMessage());
        verify(deptTypeRepository, never()).save(any());
    }

    @Test
    @DisplayName("D19. updateType 父租户不匹配 → 拒绝")
    void updateParentTenantMismatchRejected() {
        SysDeptType self = type(1L, 0L, 0);
        when(deptTypeRepository.findById(1L)).thenReturn(Optional.of(self));
        // isDescendant 先于 requireParentAllowsChildren 调用；返回空树使其判定为非环
        when(deptTypeRepository.findByTenantId(TENANT)).thenReturn(List.of());
        // 新父级属异租户
        when(deptTypeRepository.findById(3L)).thenReturn(Optional.of(typeWithTenant(3L, 999L, 0L, 0)));

        DeptTypeUpdateRequest req = new DeptTypeUpdateRequest("x", 0, 1, 3L, null);
        BusinessException ex = assertThrows(BusinessException.class, () -> deptTypeService.updateType(1L, req));
        assertEquals("上级部门类型不属于该租户", ex.getMessage());
        verify(deptTypeRepository, never()).save(any());
    }
}
