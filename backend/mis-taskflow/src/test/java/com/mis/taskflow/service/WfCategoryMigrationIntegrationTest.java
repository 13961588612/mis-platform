package com.mis.taskflow.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * V131 / V132 迁移落地验收：wf_category 表、form_definition.kind、wf_definition.category_id、
 * 权限合并（删 95007 + 95006 改 perm）、流程分类端点登记绑 95006、默认「未分类」节点回填。
 *
 * <p>不依赖任何 service bean —— 纯 JDBC 读系统表，避免「测试通过但迁移没落地」的假绿。
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class WfCategoryMigrationIntegrationTest {

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    @DisplayName("V131：wf_category 表存在，列齐备（邻接树 + uk_wf_category_tenant_code + 索引）")
    void wfCategoryTableExists() {
        List<String> cols = jdbc.queryForList("""
                select column_name from information_schema.columns
                where table_name = 'wf_category' order by ordinal_position
                """, String.class);
        assertTrue(cols.containsAll(List.of(
                        "id", "tenant_id", "parent_id", "code", "name", "description",
                        "sort_order", "config", "deleted", "created_by", "created_at", "updated_at")),
                "wf_category 列缺失，实际: " + cols);

        List<String> idx = jdbc.queryForList("select indexname from pg_indexes where tablename = 'wf_category'", String.class);
        assertTrue(idx.contains("uk_wf_category_tenant_code"), "缺唯一索引 uk_wf_category_tenant_code: " + idx);
        assertTrue(idx.contains("idx_wf_category_tree"), "缺 idx_wf_category_tree: " + idx);
    }

    @Test
    @DisplayName("V131：form_definition 新增 kind 列 + CHECK 约束")
    void formDefinitionHasKind() {
        List<String> cols = jdbc.queryForList("""
                select column_name from information_schema.columns
                where table_name = 'form_definition' order by ordinal_position
                """, String.class);
        assertTrue(cols.contains("kind"), "form_definition 应含 kind 列，实际: " + cols);

        Integer cnt = jdbc.queryForObject("""
                select count(*) from information_schema.constraint_column_usage
                where table_name = 'form_definition' and constraint_name = 'chk_form_def_kind'
                """, Integer.class);
        assertEquals(1, cnt, "应存在 chk_form_def_kind 约束");
    }

    @Test
    @DisplayName("V131：wf_definition 新增 category_id 列 + 索引")
    void wfDefinitionHasCategoryId() {
        List<String> cols = jdbc.queryForList("""
                select column_name from information_schema.columns
                where table_name = 'wf_definition' order by ordinal_position
                """, String.class);
        assertTrue(cols.contains("category_id"), "wf_definition 应含 category_id 列，实际: " + cols);

        List<String> idx = jdbc.queryForList("select indexname from pg_indexes where tablename = 'wf_definition'", String.class);
        assertTrue(idx.contains("idx_wf_def_category"), "缺 idx_wf_def_category: " + idx);
    }

    @Test
    @DisplayName("V132：菜单 95007 已删除，95006 的 permission 改为 workflow:definition:edit")
    void menuMerge() {
        Integer cnt95007 = jdbc.queryForObject("select count(*) from sys_menu where id = 95007", Integer.class);
        assertEquals(0, cnt95007, "95007 应已删除");

        String perm = jdbc.queryForObject("select permission from sys_menu where id = 95006", String.class);
        assertEquals("workflow:definition:edit", perm, "95006 的 permission 应合并为 workflow:definition:edit");
    }

    @Test
    @DisplayName("V132：流程分类端点 sys_api 95060-95065 全部登记并绑 95006")
    void wfCategoryEndpointsBound() {
        List<Map<String, Object>> apis = jdbc.queryForList("""
                select id, http_method, path_pattern from sys_api
                where id between 95060 and 95065 order by id
                """);
        assertEquals(6, apis.size(), "sys_api 应恰好 6 行: " + apis);

        // 路径与 BFF 对外路径逐字一致（deny-unmapped 校验的就是对外路径）
        assertEquals("GET", apis.get(0).get("http_method"));
        assertEquals("/api/v1/workflow/categories/tree", apis.get(0).get("path_pattern"));
        assertEquals("GET", apis.get(1).get("http_method"));
        assertEquals("/api/v1/workflow/categories", apis.get(1).get("path_pattern"));
        assertEquals("POST", apis.get(2).get("http_method"));
        assertEquals("/api/v1/workflow/categories", apis.get(2).get("path_pattern"));
        assertEquals("PUT", apis.get(3).get("http_method"));
        assertEquals("/api/v1/workflow/categories/{id:[0-9]+}", apis.get(3).get("path_pattern"));
        assertEquals("DELETE", apis.get(4).get("http_method"));
        assertEquals("/api/v1/workflow/categories/{id:[0-9]+}", apis.get(4).get("path_pattern"));
        assertEquals("GET", apis.get(5).get("http_method"));
        assertEquals("/api/v1/workflow/categories/{id:[0-9]+}", apis.get(5).get("path_pattern"));

        // 全部绑到 95006
        List<Map<String, Object>> bindings = jdbc.queryForList("""
                select ma.api_id, ma.menu_id from sys_menu_api ma
                where ma.api_id between 95060 and 95065 order by ma.api_id
                """);
        assertEquals(6, bindings.size(), "6 个端点应全部绑到 95006: " + bindings);
        for (Map<String, Object> b : bindings) {
            assertEquals(95006L, b.get("menu_id"), "端点 " + b.get("api_id") + " 应绑 95006");
        }
    }

    @Test
    @DisplayName("V132：默认「未分类」节点 990001 存在，且历史 wf_definition 已回填 category_id")
    void defaultUncategorizedNodeAndBackfill() {
        Map<String, Object> node = jdbc.queryForMap("""
                select id, tenant_id, code, name, deleted from wf_category where id = 990001
                """);
        assertEquals(1L, node.get("tenant_id"));
        assertEquals("UNCATEGORIZED", node.get("code"));
        assertEquals("未分类", node.get("name"));
        assertEquals(0, node.get("deleted"));

        // 不应有「未软删却仍无分类」的流程定义（数据回填应已全部指向 990001）
        Integer orphan = jdbc.queryForObject(
                "select count(*) from wf_definition where deleted = 0 and category_id is null", Integer.class);
        assertEquals(0, orphan, "V132 回填后不应存在未归类且未软删的流程定义");
    }

    @Test
    @DisplayName("V132：编排端点 95032/95033/95050/95056 已合并进 95006，且不违反 uk_menu_api_pair")
    void workflowApisMergedToDefinitionMenu() {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select ma.api_id, ma.menu_id from sys_menu_api ma
                where ma.api_id in (95032, 95033, 95050, 95056) order by ma.api_id
                """);
        assertEquals(4, rows.size(), "4 个编排端点应挂 95006: " + rows);
        for (Map<String, Object> r : rows) {
            assertEquals(95006L, r.get("menu_id"), "端点 " + r.get("api_id") + " 应挂 95006");
        }
        // 95030/95031 本就在 95006，不应被重复绑定（uk_menu_api_pair 兜底）
        Integer dup = jdbc.queryForObject(
                "select count(*) from sys_menu_api where menu_id = 95006 and api_id = 95030", Integer.class);
        assertEquals(1, dup, "95030 在 95006 应恰好 1 行（不重复绑定）");
    }
}
