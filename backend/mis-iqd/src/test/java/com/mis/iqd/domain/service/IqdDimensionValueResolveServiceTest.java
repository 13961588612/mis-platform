package com.mis.iqd.domain.service;

import com.mis.iqd.api.dto.IqdDimensionResolveVO;
import com.mis.iqd.domain.entity.IqdDimensionValueMap;
import com.mis.iqd.domain.repository.IqdDimensionValueMapRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 行级维度值解析单测：默认覆盖语义（裁剪后代）+ covers_subtree=0（平行，不裁剪）+ store 丢弃。
 */
class IqdDimensionValueResolveServiceTest {

    private static final long CONN = 7L;

    private IqdDimensionValueMapRepository mapRepo;
    private IqdDeptSubtreeLookup lookup;
    private IqdDimensionValueResolveService service;

    @BeforeEach
    void setup() {
        mapRepo = mock(IqdDimensionValueMapRepository.class);
        lookup = mock(IqdDeptSubtreeLookup.class);
        service = new IqdDimensionValueResolveService(mapRepo, lookup);
    }

    private IqdDimensionValueMap map(String misValue, String external, int covers) {
        IqdDimensionValueMap m = new IqdDimensionValueMap();
        m.setConnectionId(CONN);
        m.setDimensionCode("dept");
        m.setMisValue(misValue);
        m.setExternalValue(external);
        m.setEffective(1);
        m.setCoversSubtree(covers);
        return m;
    }

    private List<IqdDeptSubtreeLookup.DeptNode> nodes(String... idPathPairs) {
        java.util.List<IqdDeptSubtreeLookup.DeptNode> out = new java.util.ArrayList<>();
        for (int i = 0; i < idPathPairs.length; i += 2) {
            out.add(new IqdDeptSubtreeLookup.DeptNode(idPathPairs[i], idPathPairs[i + 1]));
        }
        return out;
    }

    @Test
    void dept_default_covers_prunes_descendants() {
        // A(unmapped) - A1(mapped, covers) - A11(mapped) ; A2(mapped, covers)
        when(lookup.subtreeNodes("A")).thenReturn(nodes(
                "A", "/0/1/A/",
                "A1", "/0/1/A/A1/",
                "A11", "/0/1/A/A1/A11/",
                "A2", "/0/1/A/A2/"));
        when(mapRepo.findByConnectionIdAndDimensionCodeAndMisValueIn(eq(CONN), eq("dept"), anyList()))
                .thenReturn(List.of(
                        map("A1", "D001", 1),
                        map("A11", "D005", 1),
                        map("A2", "D002", 1)));

        IqdDimensionResolveVO vo = service.resolve(CONN, "dept", List.of("A"));

        assertEquals(List.of("D001", "D002"), vo.resolved());
        assertFalse(vo.resolved().contains("D005"), "A11 应被 A1 覆盖裁剪，不应出现");
        assertTrue(vo.dropped().isEmpty());
        assertFalse(vo.empty());
    }

    @Test
    void dept_parallel_covers_false_keeps_descendants() {
        // A1 mapped with covers_subtree=0 (parallel) -> A11 must also be kept
        when(lookup.subtreeNodes("A")).thenReturn(nodes(
                "A", "/0/1/A/",
                "A1", "/0/1/A/A1/",
                "A11", "/0/1/A/A1/A11/"));
        when(mapRepo.findByConnectionIdAndDimensionCodeAndMisValueIn(eq(CONN), eq("dept"), anyList()))
                .thenReturn(List.of(
                        map("A1", "D001", 0),
                        map("A11", "D005", 1)));

        IqdDimensionResolveVO vo = service.resolve(CONN, "dept", List.of("A"));

        assertTrue(vo.resolved().contains("D001"));
        assertTrue(vo.resolved().contains("D005"), "covers_subtree=0 时不应裁剪后代");
    }

    @Test
    void dept_no_mapping_anywhere_dropped_and_empty() {
        when(lookup.subtreeNodes("A")).thenReturn(nodes("A", "/0/1/A/"));
        when(mapRepo.findByConnectionIdAndDimensionCodeAndMisValueIn(eq(CONN), eq("dept"), anyList()))
                .thenReturn(List.of());

        IqdDimensionResolveVO vo = service.resolve(CONN, "dept", List.of("A"));

        assertTrue(vo.resolved().isEmpty());
        assertEquals(List.of("A"), vo.dropped());
        assertTrue(vo.empty());
    }

    @Test
    void store_unmapped_dropped() {
        when(mapRepo.findByConnectionIdAndDimensionCodeAndMisValueIn(eq(CONN), eq("store"), anyList()))
                .thenReturn(List.of());

        IqdDimensionResolveVO vo = service.resolve(CONN, "store", List.of("S1", "S2"));

        assertTrue(vo.resolved().isEmpty());
        assertEquals(List.of("S1", "S2"), vo.dropped());
        assertTrue(vo.empty());
    }
}
