package com.mis.recon.dao;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * 告警留痕 DAO（T07-spec §4）：alert_log 插入 + 指纹查重（去重/限流/复盘依据）。
 */
@Repository
public class AlertLogDao {

    private final JdbcTemplate jdbcTemplate;

    public AlertLogDao(@Qualifier("reconJdbcTemplate") JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /** 指纹已存在（时间窗口内去重）；无 → false。 */
    public boolean existsByFingerprint(String fingerprint) {
        Integer cnt = jdbcTemplate.queryForObject("""
                SELECT COUNT(1) FROM recon_alert_log WHERE fingerprint = ?
                """, Integer.class, fingerprint);
        return cnt != null && cnt > 0;
    }

    /** 写一条 alert_log（detail_ids_json 允许 null → 记 '[]'；err_msg 无独立列，并入 content）。 */
    public void insert(String scenarioCode, String checkName, List<Long> detailIds,
                       String severity, String channel, String fingerprint,
                       String content, String sendStatus, String errMsg) {
        String finalContent = (errMsg == null || errMsg.isBlank())
                ? content
                : content + "\n[发送失败] " + errMsg;
        jdbcTemplate.update("""
                INSERT INTO recon_alert_log
                  (scenario_code, check_name, detail_ids_json, severity, channel,
                   fingerprint, content, send_status, retry_count, sent_at)
                VALUES (?, ?, CAST(? AS jsonb), ?, ?, ?, ?, ?, 0, now())
                """, scenarioCode, checkName, toIdsJson(detailIds), severity, channel,
                fingerprint, finalContent, sendStatus);
    }

    private String toIdsJson(List<Long> detailIds) {
        if (detailIds == null || detailIds.isEmpty()) {
            return "[]";
        }
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < detailIds.size(); i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(detailIds.get(i));
        }
        return sb.append(']').toString();
    }
}