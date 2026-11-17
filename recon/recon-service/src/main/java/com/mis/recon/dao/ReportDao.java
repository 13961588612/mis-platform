package com.mis.recon.dao;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.Collections;
import java.util.List;

/**
 * 报告运行记录 DAO（T07-spec §3，JdbcTemplate 热路径）：
 * recon_report_run 启动/收尾 + 报告扫描 + reported_at 批量回填。
 */
@Repository
public class ReportDao {

    /** 报告差异行（报告扫描结果） */
    public static class ReportRow {
        public final long id;
        public final String checkName;
        public final String matchKeyDisplay;
        public final String diffType;
        public final String diffDesc;
        public final Long diffAmountCent;
        public final Long diffPoint;   // 非货币计量（积分）差额原值（V5）
        public final java.time.LocalDateTime firstSeenAt;

        public ReportRow(long id, String checkName, String matchKeyDisplay, String diffType,
                         String diffDesc, Long diffAmountCent, Long diffPoint,
                         java.time.LocalDateTime firstSeenAt) {
            this.id = id;
            this.checkName = checkName;
            this.matchKeyDisplay = matchKeyDisplay;
            this.diffType = diffType;
            this.diffDesc = diffDesc;
            this.diffAmountCent = diffAmountCent;
            this.diffPoint = diffPoint;
            this.firstSeenAt = firstSeenAt;
        }
    }

    private final JdbcTemplate jdbcTemplate;

    public ReportDao(@Qualifier("reconJdbcTemplate") JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /** 启动报告运行：返回 id。 */
    public long insertReportRun(String scenarioCode, String reportType) {
        Long id = jdbcTemplate.queryForObject("""
                INSERT INTO recon_report_run (scenario_code, report_type, send_status, started_at)
                VALUES (?, ?, 'failed', now())
                RETURNING id
                """, Long.class, scenarioCode, reportType == null ? "diff" : reportType);
        return id == null ? 0 : id;
    }

    /**
     * 报告扫描（G25）：confirmed & 未报告 & 未处理差异；按 check_name, id 升序。
     */
    public List<ReportRow> scanForReport(String scenarioCode) {
        return jdbcTemplate.query("""
                SELECT id, check_name, match_key_display, diff_type, diff_desc, diff_amount_cent,
                       diff_point, first_seen_at
                  FROM recon_detail
                 WHERE scenario_code = ? AND status = 'confirmed'
                   AND reported_at IS NULL AND handle_status = 'unhandled'
                 ORDER BY check_name, id
                """, (rs, i) -> {
                    java.sql.Timestamp t = rs.getTimestamp("first_seen_at");
                    return new ReportRow(
                            rs.getLong("id"),
                            rs.getString("check_name"),
                            rs.getString("match_key_display"),
                            rs.getString("diff_type"),
                            rs.getString("diff_desc"),
                            rs.getLong("diff_amount_cent") == 0 && rs.wasNull() ? null : rs.getLong("diff_amount_cent"),
                            rs.getLong("diff_point") == 0 && rs.wasNull() ? null : rs.getLong("diff_point"),
                            t == null ? null : t.toLocalDateTime());
                }, scenarioCode);
    }

    /** 成功后批量回填 reported_at（G26：幂等，仅未回填的行）。 */
    public void markReported(List<Long> detailIds) {
        if (detailIds == null || detailIds.isEmpty()) {
            return;
        }
        String placeholders = String.join(",", Collections.nCopies(detailIds.size(), "?"));
        jdbcTemplate.update("""
                UPDATE recon_detail
                   SET reported_at = now(), updated_at = now()
                 WHERE id IN (%s) AND reported_at IS NULL
                """.formatted(placeholders), detailIds.toArray());
    }

    /** 收尾：send_status + diff_count + diff_amount_sum（分）+ err_msg。 */
    public void finishReportRun(long reportRunId, String sendStatus, int diffCount, long diffAmountSum, String errMsg) {
        jdbcTemplate.update("""
                UPDATE recon_report_run
                   SET send_status = ?, diff_count = ?, diff_amount_sum = ?, err_msg = ?, finished_at = now()
                 WHERE id = ?
                """, sendStatus, diffCount, diffAmountSum, errMsg, reportRunId);
    }
}