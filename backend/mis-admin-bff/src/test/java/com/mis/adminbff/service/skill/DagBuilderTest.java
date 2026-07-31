package com.mis.adminbff.service.skill;

import com.mis.adminbff.dto.ai.FieldDef;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class DagBuilderTest {

    private DagBuilder dagBuilder;

    @BeforeEach
    void setUp() {
        dagBuilder = new DagBuilder();
    }

    @Test
    void topologicalSort_emptyInput_returnsEmptyList() {
        Map<String, FieldDef> schema = Collections.emptyMap();

        List<String> result = dagBuilder.topologicalSort(schema);

        assertTrue(result.isEmpty());
    }

    @Test
    void topologicalSort_singleField_returnsThatField() {
        Map<String, FieldDef> schema = new LinkedHashMap<>();
        schema.put("onlyField", createField("string", null, null, null));

        List<String> result = dagBuilder.topologicalSort(schema);

        assertEquals(1, result.size());
        assertEquals("onlyField", result.get(0));
    }

    @Test
    void topologicalSort_noDependencies_returnsAllFields() {
        Map<String, FieldDef> schema = new LinkedHashMap<>();
        schema.put("name", createField("string", null, null, null));
        schema.put("age", createField("integer", null, null, null));

        List<String> result = dagBuilder.topologicalSort(schema);

        assertEquals(2, result.size());
        assertTrue(result.contains("name"));
        assertTrue(result.contains("age"));
    }

    @Test
    void topologicalSort_linearDag_returnsCorrectOrder() {
        // Linear chain: A → B → C
        Map<String, FieldDef> schema = new LinkedHashMap<>();
        schema.put("A", createField("string", null, null, null));
        schema.put("B", createField("string", null, "tool1", Map.of("input", "${A}")));
        schema.put("C", createField("string", null, "tool2", Map.of("input", "${B}")));

        List<String> result = dagBuilder.topologicalSort(schema);

        assertEquals(3, result.size());
        assertEquals("A", result.get(0));
        assertEquals("B", result.get(1));
        assertEquals("C", result.get(2));
    }

    @Test
    void topologicalSort_multiRoot_parallel_returnsCorrectOrder() {
        // Two roots (X, Y) feeding into Z: X→Z, Y→Z
        Map<String, FieldDef> schema = new LinkedHashMap<>();
        schema.put("X", createField("string", null, null, null));
        schema.put("Y", createField("string", null, null, null));
        schema.put("Z", createField("string", null, "tool", Map.of("a", "${X}", "b", "${Y}")));

        List<String> result = dagBuilder.topologicalSort(schema);

        assertEquals(3, result.size());
        // X and Y must both come before Z (order between X and Y is not guaranteed)
        assertTrue(result.indexOf("X") < result.indexOf("Z"));
        assertTrue(result.indexOf("Y") < result.indexOf("Z"));
        // X and Y are root nodes (indegree 0), one of them is first
        int xIdx = result.indexOf("X");
        int yIdx = result.indexOf("Y");
        assertTrue(xIdx == 0 || xIdx == 1);
        assertTrue(yIdx == 0 || yIdx == 1);
    }

    @Test
    void topologicalSort_withDependencies_returnsCorrectOrder() {
        Map<String, FieldDef> schema = new LinkedHashMap<>();
        schema.put("orgId", createField("integer", "org", "queryOrgByName", Map.of("name", "${orgName}")));
        schema.put("deptId", createField("integer", "dept", "queryDeptByName", Map.of("name", "${deptName}", "orgId", "${orgId}")));
        schema.put("personId", createField("integer", "employee", "queryEmployeeByName", Map.of("name", "${personName}")));

        List<String> result = dagBuilder.topologicalSort(schema);

        // orgId and personId have no deps on other schema fields, deptId depends on orgId
        // orgId must come before deptId
        assertTrue(result.indexOf("orgId") < result.indexOf("deptId"));
        assertEquals(3, result.size());
    }

    @Test
    void topologicalSort_circularDependency_throwsException() {
        Map<String, FieldDef> schema = new LinkedHashMap<>();
        schema.put("a", createField("integer", null, null, Map.of("x", "${b}")));
        schema.put("b", createField("integer", null, null, Map.of("x", "${a}")));

        assertThrows(IllegalArgumentException.class, () -> dagBuilder.topologicalSort(schema));
    }

    @Test
    void topologicalSort_selfDependency_throwsException() {
        Map<String, FieldDef> schema = new LinkedHashMap<>();
        schema.put("a", createField("integer", null, null, Map.of("x", "${a}")));

        assertThrows(IllegalArgumentException.class, () -> dagBuilder.topologicalSort(schema));
    }

    @Test
    void topologicalSort_referenceToNonExistentField_ignoresReference() {
        // Reference to a field not in schema should be ignored
        Map<String, FieldDef> schema = new LinkedHashMap<>();
        schema.put("A", createField("string", null, null, Map.of("input", "${nonExistent}")));
        schema.put("B", createField("string", null, null, null));

        List<String> result = dagBuilder.topologicalSort(schema);

        assertEquals(2, result.size());
        assertTrue(result.contains("A"));
        assertTrue(result.contains("B"));
    }

    @Test
    void topologicalSort_nullParamsValue_ignoresNullParam() {
        Map<String, FieldDef> schema = new LinkedHashMap<>();
        schema.put("A", createField("string", null, null, null));
        Map<String, String> paramsWithNull = new LinkedHashMap<>();
        paramsWithNull.put("key", null);
        paramsWithNull.put("other", "${A}");
        schema.put("B", createField("string", null, "tool", paramsWithNull));

        List<String> result = dagBuilder.topologicalSort(schema);

        assertEquals(2, result.size());
        assertTrue(result.indexOf("A") < result.indexOf("B"));
    }

    private FieldDef createField(String type, String entityRef, String tool, Map<String, String> params) {
        FieldDef def = new FieldDef();
        def.setType(type);
        def.setEntityRef(entityRef);
        def.setTool(tool);
        def.setParams(params);
        return def;
    }
}
