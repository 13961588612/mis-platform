package com.mis.recon.dao;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 消费游标 DAO（F67，JdbcTemplate 热路径）。
 * <p>T04 建好（uk_cursor 唯一），T05 ReconRunner per-check 消费时 get/advance。</p>
 */
@Repository
public class CursorDao {

    private final JdbcTemplate jdbcTemplate;

    public CursorDao(@Qualifier("reconJdbcTemplate") JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /** 取 (scenario, check, ds) 游标；无记录 → 0。 */
    public long get(String scenarioCode, String checkName, String dsCode) {
        // COALESCE + MAX：恒返回单行，避免无记录时 queryForObject 抛 EmptyResultDataAccessException
        Long v = jdbcTemplate.queryForObject("""
                SELECT COALESCE(MAX(cursor_seq), 0) FROM recon_consume_cursor
                 WHERE scenario_code = ? AND check_name = ? AND ds_code = ?
                """, Long.class, scenarioCode, checkName, dsCode);
        return v == null ? 0 : v;
    }

    /** 推进游标（ON CONFLICT upsert）。 */
    public void advance(String scenarioCode, String checkName, String dsCode, long seq) {
        jdbcTemplate.update("""
                INSERT INTO recon_consume_cursor (scenario_code, check_name, ds_code, cursor_seq, updated_at)
                VALUES (?, ?, ?, ?, now())
                ON CONFLICT (scenario_code, check_name, ds_code)
                DO UPDATE SET cursor_seq = EXCLUDED.cursor_seq, updated_at = now()
                """, scenarioCode, checkName, dsCode, seq);
    }

    /** 数据源重建：该 (scenario, check, ds) 游标归零（无记录则跳过），使 check 全量重放。 */
    public void reset(String scenarioCode, String checkName, String dsCode) {
        jdbcTemplate.update("""
                UPDATE recon_consume_cursor
                   SET cursor_seq = 0, updated_at = now()
                 WHERE scenario_code = ? AND check_name = ? AND ds_code = ?
                """, scenarioCode, checkName, dsCode);
    }
}
