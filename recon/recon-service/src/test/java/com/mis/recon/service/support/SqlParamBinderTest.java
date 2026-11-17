package com.mis.recon.service.support;

import com.mis.recon.common.BizException;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * SQL 参数绑定单测（G2 归一：命名参数 + 花括号兼容）。
 */
class SqlParamBinderTest {

    @Test
    void namedParamsBoundToQuestionMarks() {
        Map<String, Object> params = new HashMap<>();
        params.put("p_start", 1);
        params.put("p_end", 2);
        SqlParamBinder.BoundSql bound = SqlParamBinder.bind(
                "SELECT * FROM t WHERE ts >= :p_start AND ts < :p_end", params);
        assertEquals("SELECT * FROM t WHERE ts >= ? AND ts < ?", bound.sql);
        assertEquals(2, bound.args.length);
        assertEquals(1, bound.args[0]);
        assertEquals(2, bound.args[1]);
    }

    @Test
    void sameParamTwiceProducesTwoPlaceholders() {
        Map<String, Object> params = new HashMap<>();
        params.put("p_start", 1);
        SqlParamBinder.BoundSql bound = SqlParamBinder.bind(
                "SELECT * FROM t WHERE a = :p_start OR b = :p_start", params);
        assertEquals("SELECT * FROM t WHERE a = ? OR b = ?", bound.sql);
        assertEquals(2, bound.args.length);
    }

    @Test
    void bracedCompatibility() {
        Map<String, Object> params = new HashMap<>();
        params.put("p_start", 1);
        params.put("p_end", 2);
        SqlParamBinder.BoundSql bound = SqlParamBinder.bind(
                "SELECT * FROM t WHERE ts >= {time_start} AND ts < {time_end}", params);
        assertEquals("SELECT * FROM t WHERE ts >= ? AND ts < ?", bound.sql);
    }

    @Test
    void noPartialNameMatch() {
        Map<String, Object> params = new HashMap<>();
        params.put("p_start", 1);
        params.put("p_start_x", 99);
        SqlParamBinder.BoundSql bound = SqlParamBinder.bind(
                "SELECT * FROM t WHERE a = :p_start AND b = :p_start_x", params);
        assertEquals("SELECT * FROM t WHERE a = ? AND b = ?", bound.sql);
        assertEquals(2, bound.args.length);
        assertEquals(99, bound.args[1]);
    }

    @Test
    void missingValueThrows7007() {
        Map<String, Object> params = new HashMap<>();
        params.put("p_start", 1);
        BizException ex = assertThrows(BizException.class,
                () -> SqlParamBinder.bind("SELECT * FROM t WHERE ts >= :p_start AND ts < :p_end", params));
        assertEquals(7007, ex.getCode());
    }

    @Test
    void recordKeyBracing() {
        Map<String, Object> params = new HashMap<>();
        params.put("record_key", "A1001");
        SqlParamBinder.BoundSql bound = SqlParamBinder.bind(
                "SELECT * FROM t WHERE order_no = {record_key}", params);
        assertEquals("SELECT * FROM t WHERE order_no = ?", bound.sql);
        assertEquals("A1001", bound.args[0]);
    }
}
