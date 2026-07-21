package com.mis.common.jpa.datascope;

import com.mis.common.jpa.datascope.DataScopeSpecification.DataScopeContext;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DataScopeSpecificationTest {

    @Test
    void allScope_returnsNonNullSpec() {
        DataScopeContext ctx = new DataScopeContext(
                1L, DataScopeSpecification.SCOPE_ALL,
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
        assertNotNull(DataScopeSpecification.of(ctx, "deptId", ""));
    }

    @Test
    void deptScope_withEmptyAssigned_stillBuilds() {
        DataScopeContext ctx = new DataScopeContext(
                1L, DataScopeSpecification.SCOPE_DEPT,
                Set.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
        assertNotNull(DataScopeSpecification.of(ctx, "deptId", ""));
    }

    @Test
    void mergeAnd_combinesBaseAndScope() {
        DataScopeContext ctx = new DataScopeContext(
                1L, DataScopeSpecification.SCOPE_DEPT_AND_CHILD,
                Set.of(10L), List.of(), Set.of(10L, 11L), List.of(), List.of(), List.of(), List.of());
        var combined = DataScopeSpecification.and(
                (root, q, cb) -> cb.equal(root.get("tenantId"), 1L),
                DataScopeSpecification.of(ctx, "deptId", ""));
        assertNotNull(combined);
    }

    @Test
    void scopeConstants_matchDictionary() {
        assertEquals(1, DataScopeSpecification.SCOPE_ALL);
        assertEquals(2, DataScopeSpecification.SCOPE_DEPT);
        assertEquals(3, DataScopeSpecification.SCOPE_DEPT_AND_CHILD);
        assertEquals(4, DataScopeSpecification.SCOPE_SELF);
        assertEquals(5, DataScopeSpecification.SCOPE_CUSTOM);
        assertEquals(6, DataScopeSpecification.SCOPE_ORG);
        assertTrue(DataScopeSpecification.SCOPE_ALL < DataScopeSpecification.SCOPE_SELF);
    }
}
