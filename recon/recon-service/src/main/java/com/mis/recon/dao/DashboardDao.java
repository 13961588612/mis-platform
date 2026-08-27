package com.mis.recon.dao;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * 监控统计 / 详情 / 平衡表只读查询 DAO（T07 前端接入补充）：
 * 数据源健康总览、对账 7 天趋势、差异池账龄分布、对账运行详情（consumed_seq_json）、
 * 平衡表（零差异证明）聚合。走 reconJdbcTemplate 查询侧。
 */
@Repository
public class DashboardDao {

    private final JdbcTemplate jdbcTemplate;

    public DashboardDao(@Qualifier("reconJdbcTemplate") JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /** 数据源健康总览卡片 */
    public record DatasourceHealthRow(String dsCode, String dsName, String healthStatus,
                                      String lastErrMsg, long todaySuccessCount, LocalDateTime lastPullAt) {
    }

    /** 对账成功率趋势（按天状态计数） */
    public record ReconTrendRow(String day, String status, long cnt) {
    }

    /** 差异池账龄分布（0-1 / 1-7 / 7-30 / 30+） */
    public record DiffAgingRow(String bucket, long cnt) {
    }

    /** 对账运行详情（含 consumed_seq_json 原文，格式 {checkName:{dsCode:maxSeq}}） */
    public record ReconRunDetailRow(long id, String scenarioCode, String status,
                                    int matchedCount, int diffCount, int resolvedCount,
                                    String errMsg, String consumedSeqJson,
                                    LocalDateTime startedAt, LocalDateTime finishedAt) {
    }

    /** 报告详情按检查分组汇总（差异条数 / 差异金额合计） */
    public record ReportCheckSummary(String checkName, long diffCount, long diffAmountCent, long diffPoint) {
    }

    /** 数据源健康总览：每个启用数据源一张卡片（最新健康 + 今日成功次数 + 最近拉取时间）。 */
    public List<DatasourceHealthRow> datasourceHealth() {
        return jdbcTemplate.query("""
                SELECT d.ds_code, d.name AS ds_name,
                       COALESCE(l.health_status, 'unknown') AS health_status,
                       l.err_msg AS last_err_msg,
                       COALESCE(t.cnt, 0) AS today_success_count,
                       l.finished_at AS last_pull_at
                FROM recon_datasource d
                LEFT JOIN LATERAL (
                    SELECT p.health_status, p.err_msg, p.finished_at
                    FROM recon_pull_run p
                    WHERE p.ds_code = d.ds_code
                    ORDER BY p.id DESC
                    LIMIT 1
                ) l ON true
                LEFT JOIN LATERAL (
                    SELECT COUNT(*) AS cnt
                    FROM recon_pull_run p
                    WHERE p.ds_code = d.ds_code AND p.status = 'success'
                      AND p.started_at >= date_trunc('day', now())
                ) t ON true
                WHERE d.enabled = 1
                ORDER BY d.ds_code
                """, (rs, i) -> new DatasourceHealthRow(
                rs.getString("ds_code"), rs.getString("ds_name"),
                rs.getString("health_status"), rs.getString("last_err_msg"),
                rs.getLong("today_success_count"), time(rs, "last_pull_at")));
    }

    /** 对账成功率趋势：近 days 天按 (日, 状态) 计数（含今天）。 */
    public List<ReconTrendRow> reconTrend(int days) {
        return jdbcTemplate.query("""
                SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day,
                       status, COUNT(*) AS cnt
                FROM recon_run
                WHERE started_at >= date_trunc('day', now()) - (? * interval '1 day')
                GROUP BY 1, 2
                ORDER BY 1, 2
                """, (rs, i) -> new ReconTrendRow(rs.getString("day"), rs.getString("status"), rs.getLong("cnt")),
                Math.max(days, 1) - 1);
    }

    /** 差异池账龄分布：按 first_seen_at 分桶，池内口径 status <> 'resolved'。 */
    public List<DiffAgingRow> diffAging() {
        List<DiffAgingRow> rows = jdbcTemplate.query("""
                SELECT CASE
                         WHEN first_seen_at >= now() - interval '1 day' THEN '0-1'
                         WHEN first_seen_at >= now() - interval '7 days' THEN '1-7'
                         WHEN first_seen_at >= now() - interval '30 days' THEN '7-30'
                         ELSE '30+'
                       END AS bucket,
                       COUNT(*) AS cnt
                FROM recon_detail
                WHERE status <> 'resolved'
                GROUP BY 1
                """, (rs, i) -> new DiffAgingRow(rs.getString("bucket"), rs.getLong("cnt")));
        List<String> order = List.of("0-1", "1-7", "7-30", "30+");
        rows.sort(Comparator.comparingInt(r -> order.indexOf(r.bucket())));
        return rows;
    }

    /** 对账运行单条（详情用），不存在返回 null。 */
    public ReconRunDetailRow reconRunById(long id) {
        List<ReconRunDetailRow> rows = jdbcTemplate.query("""
                SELECT id, scenario_code, status, matched_count, diff_count, resolved_count,
                       err_msg, consumed_seq_json::text AS consumed_seq_json,
                       started_at, finished_at
                FROM recon_run
                WHERE id = ?
                """, (rs, i) -> new ReconRunDetailRow(
                rs.getLong("id"), rs.getString("scenario_code"), rs.getString("status"),
                rs.getInt("matched_count"), rs.getInt("diff_count"), rs.getInt("resolved_count"),
                rs.getString("err_msg"), rs.getString("consumed_seq_json"),
                time(rs, "started_at"), time(rs, "finished_at")), id);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** 场景在窗口内各状态轮次数：[{status, cnt}]。 */
    public List<Object[]> runStatusCounts(String scenarioCode, LocalDateTime from, LocalDateTime to) {
        return jdbcTemplate.query("""
                SELECT status, COUNT(*) AS cnt
                FROM recon_run
                WHERE scenario_code = ? AND started_at >= ? AND started_at <= ?
                GROUP BY status
                """, rs -> {
                    List<Object[]> list = new ArrayList<>();
                    while (rs.next()) {
                        list.add(new Object[]{rs.getString("status"), rs.getLong("cnt")});
                    }
                    return list;
                }, scenarioCode, from, to);
    }

    /** 场景最近成功对账轮（无则 null）。 */
    public ReconRunDetailRow latestSuccessRun(String scenarioCode) {
        List<ReconRunDetailRow> rows = jdbcTemplate.query("""
                SELECT id, scenario_code, status, matched_count, diff_count, resolved_count,
                       err_msg, consumed_seq_json::text AS consumed_seq_json,
                       started_at, finished_at
                FROM recon_run
                WHERE scenario_code = ? AND status = 'success'
                ORDER BY id DESC
                LIMIT 1
                """, (rs, i) -> new ReconRunDetailRow(
                rs.getLong("id"), rs.getString("scenario_code"), rs.getString("status"),
                rs.getInt("matched_count"), rs.getInt("diff_count"), rs.getInt("resolved_count"),
                rs.getString("err_msg"), rs.getString("consumed_seq_json"),
                time(rs, "started_at"), time(rs, "finished_at")), scenarioCode);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** 当前差异池按 diff_type 计数（status <> 'resolved'）。 */
    public Map<String, Long> diffTypeCounts(String scenarioCode) {
        List<Object[]> rows = jdbcTemplate.query("""
                SELECT diff_type, COUNT(*) AS cnt
                FROM recon_detail
                WHERE scenario_code = ? AND status <> 'resolved'
                GROUP BY diff_type
                """, rs -> {
                    List<Object[]> list = new ArrayList<>();
                    while (rs.next()) {
                        list.add(new Object[]{rs.getString("diff_type"), rs.getLong("cnt")});
                    }
                    return list;
                }, scenarioCode);
        Map<String, Long> map = new java.util.HashMap<>();
        for (Object[] row : rows) {
            map.put((String) row[0], (Long) row[1]);
        }
        return map;
    }

    /** 场景窗口内按时间列计数（col ∈ first_seen_at / resolved_at）。 */
    public long countByTimeCol(String scenarioCode, String col, LocalDateTime from, LocalDateTime to) {
        Long cnt = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM recon_detail WHERE scenario_code = ? AND "
                        + col + " >= ? AND " + col + " <= ?",
                Long.class, scenarioCode, from, to);
        return cnt == null ? 0 : cnt;
    }

    /** 当前差异池总数（status <> 'resolved'）。 */
    public long countPool(String scenarioCode) {
        Long cnt = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM recon_detail WHERE scenario_code = ? AND status <> 'resolved'",
                Long.class, scenarioCode);
        return cnt == null ? 0 : cnt;
    }

    /** 报告详情按检查分组汇总：差异条数 / 金额合计（分）/ 积分差额合计（原值，V5）。 */
    public List<ReportCheckSummary> reportCheckSummary(List<Long> detailIds) {
        if (detailIds == null || detailIds.isEmpty()) {
            return List.of();
        }
        String placeholders = String.join(",", Collections.nCopies(detailIds.size(), "?"));
        return jdbcTemplate.query("""
                SELECT check_name, COUNT(*) AS cnt, COALESCE(SUM(diff_amount_cent), 0) AS amount,
                       COALESCE(SUM(diff_point), 0) AS point
                FROM recon_detail
                WHERE id IN (%s)
                GROUP BY check_name
                ORDER BY cnt DESC
                """.formatted(placeholders),
                (rs, i) -> new ReportCheckSummary(rs.getString("check_name"),
                        rs.getLong("cnt"), rs.getLong("amount"), rs.getLong("point")),
                detailIds.toArray());
    }

    private static LocalDateTime time(java.sql.ResultSet rs, String col) throws java.sql.SQLException {
        Timestamp t = rs.getTimestamp(col);
        return t == null ? null : t.toLocalDateTime();
    }
}