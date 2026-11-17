package com.mis.recon.dao;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 已提交安全水位 DAO（F68，JdbcTemplate 热路径；技术适配 §2.3）。
 * <p>水位 = 发号顺序≠提交顺序的正确性保证：ReconRunner 只能消费到 committed_seq。</p>
 */
@Repository
public class WatermarkDao {

    private final JdbcTemplate jdbcTemplate;

    public WatermarkDao(@Qualifier("reconJdbcTemplate") JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /** 取某 ds 水位；无记录 → 0。 */
    public long get(String dsCode) {
        // COALESCE + MAX：恒返回单行，避免无记录时 queryForObject 抛 EmptyResultDataAccessException
        Long v = jdbcTemplate.queryForObject(
                "SELECT COALESCE(MAX(committed_seq), 0) FROM recon_seq_watermark WHERE ds_code = ?",
                Long.class, dsCode);
        return v == null ? 0 : v;
    }

    /** 提交水位（ON CONFLICT upsert，技术适配 §2.3 逐字）。 */
    public void commit(String dsCode, long seq) {
        jdbcTemplate.update("""
                INSERT INTO recon_seq_watermark (ds_code, committed_seq, updated_at)
                VALUES (?, ?, now())
                ON CONFLICT (ds_code)
                DO UPDATE SET committed_seq = EXCLUDED.committed_seq, updated_at = now()
                """, dsCode, seq);
    }

    /** 全部 ds 水位（T05 ReconRunner 冻结上界用）。 */
    public Map<String, Long> getAll() {
        Map<String, Long> result = new HashMap<>();
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT ds_code, committed_seq FROM recon_seq_watermark");
        for (Map<String, Object> row : rows) {
            Object seq = row.get("committed_seq");
            result.put(String.valueOf(row.get("ds_code")), seq == null ? 0 : Long.parseLong(String.valueOf(seq)));
        }
        return result;
    }
}
