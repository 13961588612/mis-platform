package com.mis.taskflow.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * V133 迁移落地验收：{@code form_category} 表、{@code form_definition.category_id}、
 * 分类行迁出、表单回填、新端点 sys_api / sys_menu_api 段位登记，以及迁移幂等。
 *
 * <p>不依赖任何 service bean —— 纯 JDBC 读系统表，避免「测试通过但迁移没落地」的假绿。
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class FormCategoryMigrationIntegrationTest {

    private static final String MIGRATION_FILE =
            "../mis-migrator/src/main/resources/db/migration/V133__form_category_split.sql";

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    @DisplayName("V133：form_category 表存在，列齐备（邻接树 + uk_form_category_tenant_code + 索引）")
    void formCategoryTableExists() {
        List<String> cols = jdbc.queryForList("""
                select column_name from information_schema.columns
                where table_name = 'form_category' order by ordinal_position
                """, String.class);
        assertTrue(cols.containsAll(List.of(
                        "id", "tenant_id", "parent_id", "code", "name", "description",
                        "sort_order", "config", "deleted", "created_by", "created_at", "updated_at")),
                "form_category 列缺失，实际: " + cols);

        List<String> idx = jdbc.queryForList("select indexname from pg_indexes where tablename = 'form_category'", String.class);
        assertTrue(idx.contains("uk_form_category_tenant_code"), "缺唯一索引 uk_form_category_tenant_code: " + idx);
        assertTrue(idx.contains("idx_form_category_tree"), "缺 idx_form_category_tree: " + idx);
    }

    @Test
    @DisplayName("V133：form_definition 新增 category_id 列 + idx_form_def_category 索引")
    void formDefinitionHasCategoryId() {
        List<String> cols = jdbc.queryForList("""
                select column_name from information_schema.columns
                where table_name = 'form_definition' order by ordinal_position
                """, String.class);
        assertTrue(cols.contains("category_id"), "form_definition 应含 category_id 列，实际: " + cols);

        List<String> idx = jdbc.queryForList("select indexname from pg_indexes where tablename = 'form_definition'", String.class);
        assertTrue(idx.contains("idx_form_def_category"), "缺 idx_form_def_category: " + idx);
    }

    @Test
    @DisplayName("V133：分类行已迁出 —— form_definition 无 kind='CATEGORY' 行，form_category 保留原 id/软删态")
    void categoryRowsMigratedOut() {
        Integer leftover = jdbc.queryForObject(
                "select count(*) from form_definition where kind = 'CATEGORY'", Integer.class);
        assertEquals(0, leftover, "form_definition 不应再有 kind='CATEGORY' 行");

        // 原 id 保留（tenant=1：BH 软删 + CS/BG/CRM 未软删）—— 不改语义、不重发号
        Integer kept = jdbc.queryForObject("""
                select count(*) from form_category
                where id in (1791564214879, 1791564214880, 1791607381265, 1791607381266)
                """, Integer.class);
        assertEquals(4, kept, "分类原 id 应被保留迁入 form_category");

        // 软删态保留：BH deleted=1，其余 deleted=0
        Integer bhDeleted = jdbc.queryForObject(
                "select deleted from form_category where id = 1791564214879", Integer.class);
        assertEquals(1, bhDeleted, "软删分类 BH 应以 deleted=1 迁入");
        Integer aliveCount = jdbc.queryForObject("""
                select count(*) from form_category
                where tenant_id = 1 and deleted = 0 and code in ('CS', 'BG', 'CRM')
                """, Integer.class);
        assertEquals(3, aliveCount, "CS/BG/CRM 应以未软删态迁入");
    }

    @Test
    @DisplayName("V133：表单 category_id 已回填（PUR_FORM→CRM；E2E_FORM 保持 NULL）")
    void formCategoryIdBackfilled() {
        // PUR_FORM 原 parent_id = CRM.id（1791607381266）⇒ category_id 回填后 join 到的分类 code 应为 CRM
        String crmCode = jdbc.queryForObject("""
                select fc.code from form_definition fd
                join form_category fc on fc.id = fd.category_id
                where fd.tenant_id = 1 and fd.code = 'PUR_FORM'
                """, String.class);
        assertEquals("CRM", crmCode, "PUR_FORM.category_id 应回填到分类 CRM");

        // tenant=900002 的 E2E_FORM 原 parent_id=0（根）⇒ category_id 保持 NULL
        Long e2eCategory = jdbc.queryForObject(
                "select category_id from form_definition where tenant_id = 900002 and code = 'E2E_FORM'",
                Long.class);
        assertEquals(null, e2eCategory, "parent=0 的 E2E_FORM 其 category_id 应保持 NULL");
    }

    @Test
    @DisplayName("V133：新端点 sys_api 95066-95071 六行，路径逐字正确")
    void sysApiSeeded() {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select id, http_method, path_pattern from sys_api
                where id between 95066 and 95071 order by id
                """);
        assertEquals(6, rows.size(), "sys_api 应恰好 6 行: " + rows);

        assertEquals("GET", rows.get(0).get("http_method"));
        assertEquals("/api/v1/form-categories/tree", rows.get(0).get("path_pattern"));
        assertEquals("GET", rows.get(1).get("http_method"));
        assertEquals("/api/v1/form-categories", rows.get(1).get("path_pattern"));
        assertEquals("POST", rows.get(2).get("http_method"));
        assertEquals("/api/v1/form-categories", rows.get(2).get("path_pattern"));
        assertEquals("PUT", rows.get(3).get("http_method"));
        assertEquals("/api/v1/form-categories/{id:[0-9]+}", rows.get(3).get("path_pattern"));
        assertEquals("DELETE", rows.get(4).get("http_method"));
        assertEquals("/api/v1/form-categories/{id:[0-9]+}", rows.get(4).get("path_pattern"));
        assertEquals("GET", rows.get(5).get("http_method"));
        assertEquals("/api/v1/form-categories/{id:[0-9]+}", rows.get(5).get("path_pattern"));
    }

    @Test
    @DisplayName("V133：新端点 sys_menu_api 95086-95091 全部绑到菜单 95011")
    void sysMenuApiSeeded() {
        List<Map<String, Object>> bindings = jdbc.queryForList("""
                select ma.api_id, ma.menu_id from sys_menu_api ma
                where ma.api_id between 95066 and 95071 order by ma.api_id
                """);
        assertEquals(6, bindings.size(), "6 个端点应全部绑定: " + bindings);
        for (Map<String, Object> b : bindings) {
            assertEquals(95011L, b.get("menu_id"), "端点 " + b.get("api_id") + " 应绑 95011");
        }

        // 休眠登记行 95051（GET /form-definitions/tree）必须原样保留（V128 幂等契约）
        List<Map<String, Object>> dormant = jdbc.queryForList("""
                select id, http_method, path_pattern from sys_api where id = 95051
                """);
        assertEquals(1, dormant.size(), "休眠登记行 95051 必须保留");
        assertEquals("/api/v1/form-definitions/tree", dormant.get(0).get("path_pattern"));
    }

    @Test
    @DisplayName("V133：迁移原文重跑两遍，关键行数不变（幂等）")
    void v133IsIdempotent() throws Exception {
        List<String> stmts = statements();
        assertTrue(stmts.size() >= 9, "V133 应至少拆出 9 条语句，实际 " + stmts.size());

        Map<String, Integer> before = snapshot();
        for (int round = 1; round <= 2; round++) {
            for (String stmt : stmts) {
                jdbc.execute(stmt);
            }
            Map<String, Integer> after = snapshot();
            assertEquals(before, after, "第 " + round + " 次重跑后行数变了，说明 V133 不幂等");
        }

        // 关键行数与验收标准一致
        Map<String, Integer> now = snapshot();
        assertEquals(6, now.get("api"), "sys_api 应有 6 行 95066-95071");
        assertEquals(6, now.get("menu_api"), "sys_menu_api 应有 6 行绑 95066-95071");
        assertEquals(0, now.get("leftover_category"), "重跑后 form_definition 仍不应有 kind='CATEGORY'");
    }

    private List<String> statements() throws Exception {
        String sql = Files.readString(Path.of(MIGRATION_FILE), StandardCharsets.UTF_8);
        String stripped = Arrays.stream(sql.split("\n"))
                .filter(line -> !line.trim().startsWith("--"))
                .reduce(new StringBuilder(), (sb, line) -> sb.append(line).append('\n'), StringBuilder::append)
                .toString();
        List<String> out = new ArrayList<>();
        for (String part : stripped.split(";")) {
            if (!part.isBlank()) {
                out.add(part.trim());
            }
        }
        return out;
    }

    private Map<String, Integer> snapshot() {
        Map<String, Integer> m = new java.util.HashMap<>();
        m.put("category", count("select count(*) from form_category"));
        m.put("form_def", count("select count(*) from form_definition"));
        m.put("api", count("select count(*) from sys_api where id between 95066 and 95071"));
        m.put("menu_api", count("select count(*) from sys_menu_api where api_id between 95066 and 95071"));
        m.put("leftover_category", count("select count(*) from form_definition where kind = 'CATEGORY'"));
        return m;
    }

    private int count(String sql) {
        Integer v = jdbc.queryForObject(sql, Integer.class);
        return v == null ? 0 : v;
    }
}
