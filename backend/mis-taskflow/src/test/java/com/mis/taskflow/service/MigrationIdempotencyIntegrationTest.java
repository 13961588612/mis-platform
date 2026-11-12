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
 * V128 幂等性验收：把迁移文件原文再执行两遍，行数必须一模一样。
 *
 * <p>为什么不用 {@code flyway:migrate} 验证：Flyway 有 {@code schema_version} 表，
 * 同一个版本只会执行一次，第二次 migrate 直接 no-op ⇒ **证明不了 SQL 本身幂等**。
 * 真正的风险是「DBA 手工重跑这段 SQL」或「测试库重放」，那时没有 Flyway 兜底。
 *
 * <p>所以这里直接读文件、剥注释、按分号切句、逐条 execute。
 * 语句里没有分号出现在字符串/函数体内的情形（已核对：全文 11 个分号，全在句尾），
 * 朴素切分是安全的。
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "MIS_DB_TEST", matches = "true")
class MigrationIdempotencyIntegrationTest {

    private static final String MIGRATION_FILE =
            "../mis-migrator/src/main/resources/db/migration/V128__form_definition_and_unpublish.sql";

    @Autowired
    private JdbcTemplate jdbc;

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

    @Test
    @DisplayName("T1.1：V128 原文重跑两遍，行数不变（建表/登记全部幂等）")
    void v128IsIdempotent() throws Exception {
        List<String> stmts = statements();
        assertEquals(7, stmts.size(), "V128 应拆出 7 条语句（建表 + 2 索引 + 菜单 + api + menu_api + role_perm），实际 " + stmts.size());

        Map<String, Integer> before = snapshot();

        for (int round = 1; round <= 2; round++) {
            for (String stmt : stmts) {
                jdbc.execute(stmt);
            }
            Map<String, Integer> after = snapshot();
            assertEquals(before, after, "第 " + round + " 次重跑后行数变了，说明 V128 不幂等");
        }

        // 顺带确认关键行数与验收标准一致
        Map<String, Integer> now = snapshot();
        assertEquals(7, now.get("api"), "sys_api 应有 7 行95050-95056");
        assertEquals(2, now.get("menu"), "sys_menu 应有 2 行 95010-95011");
        assertEquals(7, now.get("menu_api"), "sys_menu_api 应有 7 行 95050-95056");
        assertEquals(2, now.get("role_perm"), "sys_role_permission 应有 2 行授权");
        assertTrue(now.get("form_def") >= 0, "form_definition 表应可查");
    }

    private Map<String, Integer> snapshot() {
        Map<String, Integer> m = new java.util.HashMap<>();
        m.put("api", count("select count(*) from sys_api where id between 95050 and 95056"));
        m.put("menu", count("select count(*) from sys_menu where id between 95010 and 95011"));
        m.put("menu_api", count("select count(*) from sys_menu_api where id between 95050 and 95056"));
        m.put("role_perm", count("select count(*) from sys_role_permission where id between 95010 and 95011"));
        m.put("form_def", count("select count(*) from form_definition"));
        m.put("all_api", count("select count(*) from sys_api"));
        m.put("all_menu", count("select count(*) from sys_menu"));
        m.put("all_menu_api", count("select count(*) from sys_menu_api"));
        return m;
    }

    private int count(String sql) {
        Integer v = jdbc.queryForObject(sql, Integer.class);
        return v == null ? 0 : v;
    }
}