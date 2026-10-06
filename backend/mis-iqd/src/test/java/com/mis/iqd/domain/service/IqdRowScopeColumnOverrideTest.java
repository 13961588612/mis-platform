package com.mis.iqd.domain.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.common.core.exception.BusinessException;
import com.mis.iqd.domain.entity.IqdCatalogItem;
import com.mis.iqd.domain.repository.IqdAskLogRepository;
import com.mis.iqd.domain.repository.IqdCatalogItemRepository;
import com.mis.iqd.domain.repository.IqdConnectionRepository;
import com.mis.iqd.domain.repository.IqdDbProfileRepository;
import com.mis.iqd.domain.repository.IqdEditIdempotencyRepository;
import com.mis.iqd.domain.repository.IqdKnowledgeRepository;
import com.mis.iqd.domain.repository.IqdMaskRuleRepository;
import com.mis.iqd.domain.repository.IqdRowScopeDimensionRepository;
import com.mis.iqd.domain.repository.IqdScopePolicyRepository;
import com.mis.iqd.domain.repository.IqdSqlPairRepository;
import com.mis.iqd.domain.repository.IqdSyncJobRepository;
import com.mis.iqd.domain.repository.IqdTableAclRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 行级范围「对象级条件列覆盖」校验单测（P3-1）。
 *
 * <p>守卫点：
 * <ul>
 *   <li>column 合法且属于对象 catalog 字段 → 通过；</li>
 *   <li>column 不在 catalog → 42200（VALIDATION_ERROR）；</li>
 *   <li>column 含非法字符（分号/空格/括号）→ 42200；</li>
 *   <li>未写 column → 全局列（无需 catalog 校验，通过）。</li>
 * </ul>
 */
class IqdRowScopeColumnOverrideTest {

    private static final long CONN = 7L;

    private IqdCatalogItemRepository catalogRepo;
    private IqdRowScopeDimensionRepository dimensionRepo;
    private IqdAdminService service;

    @BeforeEach
    void setup() {
        catalogRepo = mock(IqdCatalogItemRepository.class);
        dimensionRepo = mock(IqdRowScopeDimensionRepository.class);
        when(dimensionRepo.existsByDimensionCode(anyString())).thenReturn(true);
        service = new IqdAdminService(
                mock(IqdConnectionRepository.class),
                mock(IqdDbProfileRepository.class),
                mock(IqdAskLogRepository.class),
                catalogRepo,
                mock(IqdScopePolicyRepository.class),
                mock(IqdTableAclRepository.class),
                mock(IqdMaskRuleRepository.class),
                dimensionRepo,
                mock(IqdSqlPairRepository.class),
                mock(IqdKnowledgeRepository.class),
                mock(IqdSyncJobRepository.class),
                mock(IqdEditIdempotencyRepository.class),
                mock(IqdChangeEventPublisher.class),
                new ObjectMapper());
    }

    private IqdCatalogItem column(String itemKey, String parentKey) {
        IqdCatalogItem c = new IqdCatalogItem();
        c.setItemKey(itemKey);
        c.setKind("column");
        c.setParentKey(parentKey);
        return c;
    }

    @Test
    void column_in_catalog_passes() {
        when(catalogRepo.findByConnectionIdAndItemKey(CONN, "pg.public.sales"))
                .thenReturn(Optional.empty());
        when(catalogRepo.findByConnectionIdAndParentKey(CONN, "pg.public.sales"))
                .thenReturn(List.of(column("pg.public.sales.org_dept_code", "pg.public.sales")));
        assertDoesNotThrow(() -> service.validateRowScope(
                CONN, "pg.public.sales", "{\"dimension\":\"dept\",\"column\":\"org_dept_code\"}"));
    }

    @Test
    void column_not_in_catalog_rejected_42200() {
        when(catalogRepo.findByConnectionIdAndItemKey(anyLong(), anyString()))
                .thenReturn(Optional.empty());
        when(catalogRepo.findByConnectionIdAndParentKey(anyLong(), anyString()))
                .thenReturn(List.of(column("pg.public.sales.dept_id", "pg.public.sales")));
        BusinessException ex = assertThrows(BusinessException.class, () -> service.validateRowScope(
                CONN, "pg.public.sales", "{\"dimension\":\"dept\",\"column\":\"not_a_column\"}"));
        assertTrue(String.valueOf(ex.getMessage()).contains("catalog")
                || String.valueOf(ex.getMessage()).contains("不属于"));
    }

    @Test
    void illegal_column_rejected_42200() {
        for (String bad : new String[]{"dept_id;DROP", "dept id", "col(x)", "dept_id--"}) {
            BusinessException ex = assertThrows(BusinessException.class, () -> service.validateRowScope(
                    CONN, "pg.public.sales", "{\"dimension\":\"dept\",\"column\":\"" + bad + "\"}"));
            assertNotNull(ex.getMessage());
        }
    }

    @Test
    void no_column_no_catalog_lookup() {
        assertDoesNotThrow(() -> service.validateRowScope(
                CONN, "pg.public.sales", "{\"dimension\":\"dept\"}"));
    }
}
