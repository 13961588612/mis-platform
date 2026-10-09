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
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * V128 迁移落地验收：{@code form_definition} 表与sys_api / sys_menu / sys_menu_api 段位登记。
 *
 * <p>不依赖任何service bean —— 纯 JDBC 读系统表，避免「测试通过但迁移没落地」的假绿。
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class FormDefinitionMigrationIntegrationTest {

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    @DisplayName("T1.1：form_definition 表存在，uk / 两个索引齐备")
    void formDefinitionTableExists() {
        List<String> cols = jdbc.queryForList("""
                select column_name from information_schema.columns
                where table_name = 'form_definition' order by ordinal_position
                """, String.class);
        assertTrue(cols.containsAll(List.of(
                        "id", "tenant_id", "parent_id", "code", "name", "description",
                        "status", "sort_order", "config", "deleted", "created_by", "created_at", "updated_at")),
                "form_definition 列缺失，实际: " + cols);

        List<String> idx = jdbc.queryForList("select indexname from pg_indexes where tablename = 'form_definition'", String.class);
        assertTrue(idx.contains("uk_form_def_tenant_code"), "缺唯一索引 uk_form_def_tenant_code: " + idx);
        assertTrue(idx.contains("idx_form_def_tree"), "缺 idx_form_def_tree: " + idx);
        assertTrue(idx.contains("idx_form_def_status"), "缺 idx_form_def_status: " + idx);
    }

    @Test
    @DisplayName("T1.1：sys_api 新增 7 行 95050-95056，含补登记的 PUT /workflow/definitions/{id}")
    void sysApiSeeded() {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select id, http_method, path_pattern from sys_api
                where id between 95050 and 95056 order by id
                """);
        assertEquals(7, rows.size(), "sys_api 应恰好 7 行，实际: " + rows);

        assertEquals("POST", rows.get(0).get("http_method"));
        assertEquals("/api/v1/workflow/definitions/{id:[0-9]+}/deactivate", rows.get(0).get("path_pattern"));
        assertEquals("GET", rows.get(1).get("http_method"));
        assertEquals("/api/v1/form-definitions/tree", rows.get(1).get("path_pattern"));
        assertEquals("GET", rows.get(2).get("http_method"));
        assertEquals("/api/v1/form-definitions", rows.get(2).get("path_pattern"));
        assertEquals("POST", rows.get(3).get("http_method"));
        assertEquals("/api/v1/form-definitions", rows.get(3).get("path_pattern"));
        assertEquals("PUT", rows.get(4).get("http_method"));
        assertEquals("/api/v1/form-definitions/{id:[0-9]+}", rows.get(4).get("path_pattern"));
        assertEquals("DELETE", rows.get(5).get("http_method"));
        assertEquals("/api/v1/form-definitions/{id:[0-9]+}", rows.get(5).get("path_pattern"));

        // 最关键的一条：PUT /workflow/definitions/{id} —— V123 漏登记导致「编辑已有定义」一直 403
        Map<String, Object> put = rows.get(6);
        assertEquals(95056L, put.get("id"));
        assertEquals("PUT", put.get("http_method"));
        assertEquals("/api/v1/workflow/definitions/{id:[0-9]+}", put.get("path_pattern"));
    }

    @Test
    @DisplayName("T1.1：sys_menu 新增 95010 目录 + 95011 页面，目录 permission 必须为 NULL")
    void sysMenuSeeded() {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select id, code, type, permission, parent_id from sys_menu
                where id between 95010 and 95011 order by id
                """);
        assertEquals(2, rows.size(), "sys_menu 应恰好 2 行: " + rows);
        assertEquals("biz-form-defs", rows.get(0).get("code"));
        assertEquals(null, rows.get(0).get("permission"), "目录行permission 必须为 NULL（uk_menu_app_permission 部分唯一索引）");
        assertEquals("biz-form-list", rows.get(1).get("code"));
        assertEquals("biz:form:list", rows.get(1).get("permission"));
        assertEquals(95010L, rows.get(1).get("parent_id"), "页面应挂在 95010 目录下");
    }

    @Test
    @DisplayName("T1.1：sys_menu_api 新增 7 行绑定")
    void sysMenuApiSeeded() {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select ma.id, ma.menu_id, ma.api_id from sys_menu_api ma
                where ma.id between 95050 and 95056 order by ma.id
                """);
        assertEquals(7, rows.size(), "sys_menu_api 应恰好 7 行: " + rows);
        for (Map<String, Object> r : rows) {
            assertEquals(r.get("id"), r.get("api_id"), "sys_menu_api.id 应与 api_id 一一对应");
        }
        // 取消发布(95050) 与 PUT 更新定义(95056) 挂「流程编排」95007
        assertEquals(95007L, rows.get(0).get("menu_id"), "取消发布应挂 95007");
        assertEquals(95007L, rows.get(6).get("menu_id"), "PUT 更新定义应挂 95007");
        // 表单 CRUD(95051-95055) 挂「表单注册」95011
        for (int i = 1; i <= 5; i++) {
            assertEquals(95011L, rows.get(i).get("menu_id"), "第 " + i + " 行应挂 95011");
        }
    }

    @Test
    @DisplayName("T1.1：V128 不得改动 V127 的个人事务菜单 permission（必须保持 NULL）")
    void personalTaskMenusUntouched() {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select id, permission from sys_menu
                where id between 95001 and 95005 order by id
                """);
        assertEquals(5, rows.size());
        rows.forEach(r -> assertEquals(null, r.get("permission"),
                "V127 的个人事务菜单 " + r.get("id") + " permission 必须保持 NULL"));
    }
}