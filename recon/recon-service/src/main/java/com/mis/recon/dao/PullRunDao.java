package com.mis.recon.dao;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 拉取运行记录 DAO（F66，JdbcTemplate 热路径）。
 */
@Repository
public class PullRunDao {

    private final JdbcTemplate jdbcTemplate;

    public PullRunDao(@Qualifier("reconJdbcTemplate") JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /** 启动：insert running 行，返回 id。 */
    public long start(String dsCode, LocalDateTime windowStart, LocalDateTime windowEnd) {
        Long id = jdbcTemplate.queryForObject("""
                INSERT INTO recon_pull_run (ds_code, window_start, window_end, status, started_at)
                VALUES (?, ?, ?, 'running', now())
                RETURNING id
                """, Long.class, dsCode, windowStart, windowEnd);
        return id == null ? 0 : id;
    }

    /** 数据源重建：删除该数据源全部拉取运行记录（重置窗口水位），返回删除行数。 */
    public int deleteByDs(String dsCode) {
        return jdbcTemplate.update("DELETE FROM recon_pull_run WHERE ds_code = ?", dsCode);
    }

    /** 最近一次成功运行的 window_end（G4 窗口衔接）；无 → null。 */
    public LocalDateTime findLastSuccessWindowEnd(String dsCode) {
        // queryForObject 遇 0 行会抛 EmptyResultDataAccessException（首次成功拉取时无历史），须用 queryForList
        List<Timestamp> list = jdbcTemplate.queryForList("""
                SELECT window_end FROM recon_pull_run
                 WHERE ds_code = ? AND status = 'success'
                 ORDER BY id DESC LIMIT 1
                """, Timestamp.class, dsCode);
        return list.isEmpty() ? null : list.get(0).toLocalDateTime();
    }

    /** 最近一次成功运行的行数（G10 健康度波动基准）；无 → null。 */
    public Integer findLastSuccessRowCount(String dsCode) {
        List<Integer> list = jdbcTemplate.queryForList("""
                SELECT row_count FROM recon_pull_run
                 WHERE ds_code = ? AND status = 'success'
                 ORDER BY id DESC LIMIT 1
                """, Integer.class, dsCode);
        return list.isEmpty() ? null : list.get(0);
    }

    /** 收尾：success（含健康度 + 统计）。 */
    public void finishSuccess(long runId, String healthStatus, String healthDetailJson,
                              int rowCount, int insertCount, int updateCount, Integer clockSkewMs) {
        jdbcTemplate.update("""
                UPDATE recon_pull_run
                   SET status = 'success', health_status = ?, health_detail_json = CAST(? AS jsonb),
                       row_count = ?, insert_count = ?, update_count = ?, clock_skew_ms = ?,
                       finished_at = now()
                 WHERE id = ?
                """, healthStatus, healthDetailJson, rowCount, insertCount, updateCount, clockSkewMs, runId);
    }

    /** 收尾：failed（含 err_msg + 健康度）。 */
    public void finishFailed(long runId, String errMsg, String healthDetailJson) {
        jdbcTemplate.update("""
                UPDATE recon_pull_run
                   SET status = 'failed', err_msg = ?, health_status = 'error',
                       health_detail_json = COALESCE(CAST(? AS jsonb), health_detail_json),
                       finished_at = now()
                 WHERE id = ?
                """, errMsg, healthDetailJson, runId);
    }

    /** 就绪门三字段回写（T06-spec §4.3）：readiness_passed/degraded/log。 */
    public void updateReadiness(long runId, int passed, int degraded, String logJson) {
        jdbcTemplate.update("""
                UPDATE recon_pull_run
                   SET readiness_passed = ?, readiness_degraded = ?, readiness_log = CAST(? AS jsonb)
                 WHERE id = ?
                """, passed, degraded, logJson == null ? "{}" : logJson, runId);
    }

    /** 最近一次完成运行的健康度（健康闸门：degraded/error → 不健康）；无记录 → null。 */
    public String findLatestHealth(String dsCode) {
        var list = jdbcTemplate.queryForList("""
                SELECT health_status FROM recon_pull_run
                 WHERE ds_code = ? AND status IN ('success', 'failed')
                 ORDER BY id DESC LIMIT 1
                """, String.class, dsCode);
        return list.isEmpty() ? null : list.get(0);
    }

    /** 最大成功运行 id（两轮确认条件①：对端水位）；无 → 0。 */
    public long findMaxSuccessId(String dsCode) {
        Long id = jdbcTemplate.queryForObject("""
                SELECT MAX(id) FROM recon_pull_run
                 WHERE ds_code = ? AND status = 'success'
                """, Long.class, dsCode);
        return id == null ? 0 : id;
    }

    /** 僵尸运行扫描（T06-spec §6）：running 超 minutes 分钟；无 → 空列表。 */
    public List<Long> scanRunningOlderThan(int minutes) {
        return jdbcTemplate.queryForList("""
                SELECT id FROM recon_pull_run
                 WHERE status = 'running'
                   AND started_at < now() - (? * interval '1 minute')
                """, Long.class, minutes);
    }
}
