package com.mis.recon.service.support;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * 方言单测（键集 SQL 形态 / 时钟探针 / 引用规则）。
 * <p>分页不在 SQL 层拼接（统一 JDBC setMaxRows），故 wrapKeyset 不含 LIMIT/ROWNUM/FETCH。</p>
 */
class DbDialectTest {

    @Test
    void pgClockProbe() {
        assertEquals("SELECT now()", DbDialect.postgresql.clockProbeSql());
    }

    @Test
    void mysqlKeysetWrap() {
        String sql = "SELECT * FROM huadi2.order WHERE update_time >= ? AND update_time < ?";
        String wrapped = DbDialect.mysql.wrapKeyset(sql,
                new Object[]{1, 2}, "update_time", "order_no", 2000);
        assertEquals("SELECT * FROM ( " + sql + " ) AS t"
                + " WHERE t.`update_time` > ? OR (t.`update_time` = ? AND t.`order_no` > ?)"
                + " ORDER BY t.`update_time`, t.`order_no`", wrapped);
        assertFalse(wrapped.contains("LIMIT"), "分页由 JDBC setMaxRows 控制，SQL 不拼 LIMIT");
    }

    @Test
    void oracleKeysetWrapIsDialectClean() {
        // Oracle 11g 兼容：禁用 AS 别名、列名不加引号、SQL 无 ROWNUM/FETCH（分页走 setMaxRows）
        String sql = "SELECT * FROM t WHERE ts >= ?";
        String wrapped = DbDialect.oracle.wrapKeyset(sql, new Object[]{1}, "ts", "id", 100);
        assertEquals("SELECT * FROM ( " + sql + " ) t"
                + " WHERE t.ts > ? OR (t.ts = ? AND t.id > ?)"
                + " ORDER BY t.ts, t.id", wrapped);
        assertFalse(wrapped.contains("AS t"), "Oracle 表别名禁用 AS");
        assertFalse(wrapped.contains("FETCH"), "Oracle 11g 不支持 FETCH FIRST");
        assertFalse(wrapped.contains("ROWNUM"), "分页由 JDBC setMaxRows 控制");
        assertFalse(wrapped.contains("\""), "Oracle 列名不加引号（防 ORA-00904 大小写不匹配）");
        // Oracle 未加引号标识符必须以字母开头：别名 t 合法，杜绝 `_t` 之类触发 ORA-00911
        assertFalse(wrapped.contains("_t"), "Oracle 未加引号标识符不允许下划线开头（ORA-00911）");
    }

    @Test
    void pgKeysetWrapQuotesIdentifiers() {
        String sql = "SELECT * FROM t WHERE ts >= ?";
        String wrapped = DbDialect.postgresql.wrapKeyset(sql, new Object[]{1}, "ts", "id", 100);
        assertEquals("SELECT * FROM ( " + sql + " ) AS t"
                + " WHERE t.\"ts\" > ? OR (t.\"ts\" = ? AND t.\"id\" > ?)"
                + " ORDER BY t.\"ts\", t.\"id\"", wrapped);
    }

    @Test
    void fromUnsupportedThrows() {
        assertThrows(IllegalArgumentException.class, () -> DbDialect.from("sqlserver"));
    }

    @Test
    void fromCaseInsensitive() {
        assertEquals(DbDialect.mysql, DbDialect.from("MySQL"));
    }
}
