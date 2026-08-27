package com.mis.recon.dao;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 对账运行记录 DAO（T05-spec §5）：recon_run 启动 / 收尾 / 统计。
 */
@Repository
public class ReconRunDao {

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public ReconRunDao(@Qualifier("reconJdbcTemplate") JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    /** 启动：返回 run id */
    public long insertRun(String scenarioCode) {
        Long id = jdbcTemplate.queryForObject("""
                INSERT INTO recon_run (scenario_code, status, started_at)
                VALUES (?, 'running', now())
                RETURNING id
                """, Long.class, scenarioCode);
        return id == null ? 0 : id;
    }

    /**
     * 收尾：status success/failed/skipped + 统计 + consumed_seq_json。
     *
     * @param consumedByCheck {checkName: {dsCode: maxSeq, ...}}（time_window 检查 ds 记 0 + window 键）
     */
    public void finishRun(long runId, String status, int matchedCount, int diffCount, int resolvedCount,
                          Map<String, Map<String, Object>> consumedByCheck, String errMsg) {
        jdbcTemplate.update("""
                UPDATE recon_run
                   SET matched_count = ?, diff_count = ?, resolved_count = ?,
                       consumed_seq_json = CAST(? AS jsonb),
                       status = ?, err_msg = ?, finished_at = now()
                 WHERE id = ?
                """, matchedCount, diffCount, resolvedCount, toJson(consumedByCheck), status, errMsg, runId);
    }

    /** skip（健康闸门，游标不推进） */
    public void skipRun(long runId, String errMsg) {
        jdbcTemplate.update("""
                UPDATE recon_run
                   SET status = 'skipped', err_msg = ?, finished_at = now()
                 WHERE id = ?
                """, errMsg, runId);
    }

    /** 欠账窗口记录（健康闸门 skip 时写入，T06 补算触发消费） */
    public void insertBacklog(String scenarioCode, String checkName, java.time.LocalDateTime windowStart,
                              java.time.LocalDateTime windowEnd) {
        jdbcTemplate.update("""
                INSERT INTO recon_backlog_window (scenario_code, check_name, window_start, window_end, created_at)
                VALUES (?, ?, ?, ?, now())
                """, scenarioCode, checkName, windowStart, windowEnd);
    }

    /** 僵尸运行扫描（T06-spec §6）：running 超 minutes 分钟；无 → 空列表。 */
    public List<Long> scanRunningOlderThan(int minutes) {
        return jdbcTemplate.queryForList("""
                SELECT id FROM recon_run
                 WHERE status = 'running'
                   AND started_at < now() - (? * interval '1 minute')
                """, Long.class, minutes);
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value == null ? new LinkedHashMap<>() : value);
        } catch (JsonProcessingException e) {
            return "{}";
        }
    }
}
