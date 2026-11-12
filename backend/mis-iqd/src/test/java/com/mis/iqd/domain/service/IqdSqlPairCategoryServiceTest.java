package com.mis.iqd.domain.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.common.core.exception.BusinessException;
import com.mis.iqd.api.dto.IqdSqlPairCategorySaveRequest;
import com.mis.iqd.api.dto.IqdSqlPairCategoryVO;
import com.mis.iqd.domain.entity.IqdSqlPairCategory;
import com.mis.iqd.domain.repository.IqdAskLogRepository;
import com.mis.iqd.domain.repository.IqdCatalogItemRepository;
import com.mis.iqd.domain.repository.IqdConnectionRepository;
import com.mis.iqd.domain.repository.IqdEditIdempotencyRepository;
import com.mis.iqd.domain.repository.IqdKnowledgeRepository;
import com.mis.iqd.domain.repository.IqdMaskRuleRepository;
import com.mis.iqd.domain.repository.IqdRowScopeDimensionRepository;
import com.mis.iqd.domain.repository.IqdScopePolicyRepository;
import com.mis.iqd.domain.repository.IqdSqlPairCategoryRepository;
import com.mis.iqd.domain.repository.IqdSqlPairRepository;
import com.mis.iqd.domain.repository.IqdSyncJobRepository;
import com.mis.iqd.domain.repository.IqdTableAclRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
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
 * 样本对分类：删前引用校验 + 树组装。
 */
@ExtendWith(MockitoExtension.class)
class IqdSqlPairCategoryServiceTest {

    @Mock IqdConnectionRepository connectionRepository;
    @Mock IqdAskLogRepository askLogRepository;
    @Mock IqdCatalogItemRepository catalogItemRepository;
    @Mock IqdScopePolicyRepository scopePolicyRepository;
    @Mock IqdTableAclRepository tableAclRepository;
    @Mock IqdMaskRuleRepository maskRuleRepository;
    @Mock IqdRowScopeDimensionRepository dimensionRepository;
    @Mock IqdSqlPairRepository sqlPairRepository;
    @Mock IqdSqlPairCategoryRepository sqlPairCategoryRepository;
    @Mock IqdKnowledgeRepository knowledgeRepository;
    @Mock IqdSyncJobRepository syncJobRepository;
    @Mock IqdEditIdempotencyRepository editIdempotencyRepository;
    @Mock IqdChangeEventPublisher changeEventPublisher;
    @Mock ObjectMapper objectMapper;

    @InjectMocks
    IqdAdminService service;

    private static final long CONNECTION_ID = 42L;
    private static final long CAT_ID = 9001L;

    private IqdSqlPairCategory category() {
        IqdSqlPairCategory c = new IqdSqlPairCategory();
        c.setId(CAT_ID);
        c.setConnectionId(CONNECTION_ID);
        c.setParentId(IqdSqlPairCategory.ROOT_PARENT_ID);
        c.setCode("sales");
        c.setName("销售");
        c.setSortOrder(0);
        c.setEnabled(1);
        c.setCreatedAt(Instant.parse("2026-01-01T00:00:00Z"));
        c.setUpdatedAt(c.getCreatedAt());
        return c;
    }

    @Test
    @DisplayName("有挂载样本时禁止删除分类")
    void delete_rejectsWhenPairsMounted() {
        when(sqlPairCategoryRepository.findById(CAT_ID)).thenReturn(Optional.of(category()));
        when(sqlPairCategoryRepository.countByConnectionIdAndParentId(CONNECTION_ID, CAT_ID)).thenReturn(0L);
        when(sqlPairRepository.countByCategoryId(CAT_ID)).thenReturn(2L);

        BusinessException ex = assertThrows(BusinessException.class, () -> service.deleteSqlPairCategory(CAT_ID));
        assertEquals(true, ex.getMessage().contains("样本对"));
        verify(sqlPairCategoryRepository, never()).delete(any());
    }

    @Test
    @DisplayName("无子节点无挂载时可删除")
    void delete_okWhenEmpty() {
        when(sqlPairCategoryRepository.findById(CAT_ID)).thenReturn(Optional.of(category()));
        when(sqlPairCategoryRepository.countByConnectionIdAndParentId(CONNECTION_ID, CAT_ID)).thenReturn(0L);
        when(sqlPairRepository.countByCategoryId(CAT_ID)).thenReturn(0L);

        service.deleteSqlPairCategory(CAT_ID);

        verify(sqlPairCategoryRepository).delete(any(IqdSqlPairCategory.class));
    }

    @Test
    @DisplayName("分类树按 parent 组装")
    void tree_buildsHierarchy() {
        when(connectionRepository.existsById(CONNECTION_ID)).thenReturn(true);
        IqdSqlPairCategory root = category();
        IqdSqlPairCategory child = new IqdSqlPairCategory();
        child.setId(9002L);
        child.setConnectionId(CONNECTION_ID);
        child.setParentId(CAT_ID);
        child.setCode("sales-east");
        child.setName("华东");
        child.setSortOrder(0);
        child.setEnabled(1);
        child.setCreatedAt(root.getCreatedAt());
        child.setUpdatedAt(root.getCreatedAt());
        when(sqlPairCategoryRepository.findByConnectionIdOrderByParentIdAscCodeAscIdAsc(CONNECTION_ID))
                .thenReturn(List.of(root, child));

        List<IqdSqlPairCategoryVO> tree = service.listSqlPairCategoryTree(CONNECTION_ID);

        assertEquals(1, tree.size());
        assertEquals("销售", tree.get(0).getName());
        assertEquals(1, tree.get(0).getChildren().size());
        assertEquals("华东", tree.get(0).getChildren().get(0).getName());
    }

    @Test
    @DisplayName("同级分类按 code 编号顺序（非 id / sort_order）")
    void tree_siblingsOrderedByCode() {
        when(connectionRepository.existsById(CONNECTION_ID)).thenReturn(true);
        Instant now = Instant.parse("2026-01-01T00:00:00Z");
        IqdSqlPairCategory laterIdButSmallerCode = new IqdSqlPairCategory();
        laterIdButSmallerCode.setId(9003L);
        laterIdButSmallerCode.setConnectionId(CONNECTION_ID);
        laterIdButSmallerCode.setParentId(IqdSqlPairCategory.ROOT_PARENT_ID);
        laterIdButSmallerCode.setCode("10");
        laterIdButSmallerCode.setName("十");
        laterIdButSmallerCode.setSortOrder(99);
        laterIdButSmallerCode.setEnabled(1);
        laterIdButSmallerCode.setCreatedAt(now);
        laterIdButSmallerCode.setUpdatedAt(now);
        IqdSqlPairCategory earlierIdButLargerCode = new IqdSqlPairCategory();
        earlierIdButLargerCode.setId(9001L);
        earlierIdButLargerCode.setConnectionId(CONNECTION_ID);
        earlierIdButLargerCode.setParentId(IqdSqlPairCategory.ROOT_PARENT_ID);
        earlierIdButLargerCode.setCode("02");
        earlierIdButLargerCode.setName("二");
        earlierIdButLargerCode.setSortOrder(0);
        earlierIdButLargerCode.setEnabled(1);
        earlierIdButLargerCode.setCreatedAt(now);
        earlierIdButLargerCode.setUpdatedAt(now);
        // 仓库已按 code 排好：02 在前，10 在后
        when(sqlPairCategoryRepository.findByConnectionIdOrderByParentIdAscCodeAscIdAsc(CONNECTION_ID))
                .thenReturn(List.of(earlierIdButLargerCode, laterIdButSmallerCode));

        List<IqdSqlPairCategoryVO> tree = service.listSqlPairCategoryTree(CONNECTION_ID);

        assertEquals(2, tree.size());
        assertEquals("02", tree.get(0).getCode());
        assertEquals("10", tree.get(1).getCode());
    }

    @Test
    @DisplayName("新建分类：编码冲突拒绝")
    void create_rejectsDuplicateCode() {
        when(connectionRepository.existsById(CONNECTION_ID)).thenReturn(true);
        when(sqlPairCategoryRepository.findByConnectionIdAndCode(CONNECTION_ID, "sales"))
                .thenReturn(Optional.of(category()));

        IqdSqlPairCategorySaveRequest req =
                new IqdSqlPairCategorySaveRequest(CONNECTION_ID, null, "sales", "销售", 0, true);

        assertThrows(BusinessException.class, () -> service.createSqlPairCategory(req));
    }
}
