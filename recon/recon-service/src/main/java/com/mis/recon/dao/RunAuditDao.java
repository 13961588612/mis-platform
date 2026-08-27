package com.mis.recon.dao;

import com.mis.recon.common.PageResult;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.util.StringUtils;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * 运行记录只读查询 DAO（T07 前端接入补充）：report_run / alert_log / recon_run / pull_run 分页。
 * 走 JdbcTemplate 查询侧；金额/健康度等字段已在写侧落库。
 */
@Repository
public class RunAuditDao {

    private final JdbcTemplate jdbcTemplate;

    public RunAuditDao(@Qualifier("reconJdbcTemplate") JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /** 报告运行记录 */
    public record ReportRunRow(long id, String scenarioCode, String reportType,
                               int diffCount, String sendStatus, String errMsg,
                               LocalDateTime startedAt, LocalDateTime finishedAt) {
    }

    /** 告警留痕记录 */
    public record AlertLogRow(long id, String scenarioCode, String checkName,
                              String detailIdsJson, String severity, String channel,
                              String fingerprint, String content, String sendStatus,
                              int retryCount, LocalDateTime sentAt) {
    }

    /** 对账运行记录 */
    public record ReconRunRow(long id, String scenarioCode, String status,
                              int matchedCount, int diffCount, int resolvedCount,
                              String errMsg, LocalDateTime startedAt, LocalDateTime finishedAt) {
    }

    /** 拉取运行记录 */
    public record PullRunRow(long id, String dsCode, String windowStart, String windowEnd,
                             String status, String healthStatus, int rowCount,
                             int insertCount, int updateCount, String errMsg,
                             LocalDateTime startedAt, LocalDateTime finishedAt) {
    }

    public PageResult<ReportRunRow> reportRuns(String scenarioCode, String reportType, String sendStatus,
                                               LocalDateTime dateFrom, LocalDateTime dateTo,
                                               int page, int size) {
        List<Object> args = new ArrayList<>();
        StringBuilder sql = new StringBuilder(reportRunSelect());
        boolean first = true;
        first = textCond(sql, args, first, "scenario_code", scenarioCode);
        first = textCond(sql, args, first, "report_type", reportType);
        first = textCond(sql, args, first, "send_status", sendStatus);
        first = timeCond(sql, args, first, "started_at", dateFrom, ">=");
        timeCond(sql, args, first, "started_at", dateTo, "<=");
        sql.append(" ORDER BY id DESC");
        return queryPage(sql.toString(), reportRunMap(), args.toArray(), page, size);
    }

    /** 报告运行单条（报告详情用）。 */
    public ReportRunRow reportRunById(long id) {
        List<ReportRunRow> rows = jdbcTemplate.query(
                reportRunSelect() + " WHERE id = ?",
                reportRunMap(), id);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /**
     * 某次报告运行产生的告警留痕：按 scenario + 运行时间窗口关联（alert_log 未落 report_run_id，
     * ReportRunner 的 record 发生在运行窗口内）。运行中（finished_at 为空）则只按开始时间下限。
     */
    public List<AlertLogRow> reportRunAlerts(String scenarioCode, LocalDateTime startedAt, LocalDateTime finishedAt) {
        List<Object> args = new ArrayList<>();
        StringBuilder sql = new StringBuilder(alertLogSelect());
        boolean first = true;
        first = textCond(sql, args, first, "scenario_code", scenarioCode);
        first = timeCond(sql, args, first, "sent_at", startedAt, ">=");
        timeCond(sql, args, first, "sent_at", finishedAt, "<=");
        sql.append(" ORDER BY id");
        return jdbcTemplate.query(sql.toString(), alertLogMap(), args.toArray());
    }

    public PageResult<AlertLogRow> alertLogs(String scenarioCode, String severity, String channel,
                                             int page, int size) {
        List<Object> args = new ArrayList<>();
        StringBuilder sql = new StringBuilder(alertLogSelect());
        boolean first = true;
        first = textCond(sql, args, first, "scenario_code", scenarioCode);
        first = textCond(sql, args, first, "severity", severity);
        textCond(sql, args, first, "channel", channel);
        sql.append(" ORDER BY id DESC");
        return queryPage(sql.toString(), alertLogMap(), args.toArray(), page, size);
    }

    public PageResult<ReconRunRow> reconRuns(String scenarioCode, String status,
                                             LocalDateTime dateFrom, LocalDateTime dateTo,
                                             int page, int size) {
        List<Object> args = new ArrayList<>();
        StringBuilder sql = new StringBuilder(reconRunSelect());
        boolean first = true;
        first = textCond(sql, args, first, "scenario_code", scenarioCode);
        first = textCond(sql, args, first, "status", status);
        first = timeCond(sql, args, first, "started_at", dateFrom, ">=");
        timeCond(sql, args, first, "started_at", dateTo, "<=");
        sql.append(" ORDER BY id DESC");
        return queryPage(sql.toString(), reconRunMap(), args.toArray(), page, size);
    }

    public PageResult<PullRunRow> pullRuns(String dsCode, String status, String healthStatus,
                                           LocalDateTime dateFrom, LocalDateTime dateTo,
                                           int page, int size) {
        List<Object> args = new ArrayList<>();
        StringBuilder sql = new StringBuilder(pullRunSelect());
        boolean first = true;
        first = textCond(sql, args, first, "ds_code", dsCode);
        first = textCond(sql, args, first, "status", status);
        first = textCond(sql, args, first, "health_status", healthStatus);
        first = timeCond(sql, args, first, "started_at", dateFrom, ">=");
        timeCond(sql, args, first, "started_at", dateTo, "<=");
        sql.append(" ORDER BY id DESC");
        return queryPage(sql.toString(), pullRunMap(), args.toArray(), page, size);
    }

    // ---------------- SQL 与 RowMapper ----------------

    private static String reportRunSelect() {
        return "SELECT id, scenario_code, report_type, diff_count, send_status, err_msg, "
                + "started_at, finished_at FROM recon_report_run";
    }

    private RowMapper<ReportRunRow> reportRunMap() {
        return (rs, i) -> new ReportRunRow(rs.getLong("id"), rs.getString("scenario_code"),
                rs.getString("report_type"), rs.getInt("diff_count"), rs.getString("send_status"),
                rs.getString("err_msg"), time(rs, "started_at"), time(rs, "finished_at"));
    }

    private static String alertLogSelect() {
        return "SELECT id, scenario_code, check_name, detail_ids_json, severity, channel, "
                + "fingerprint, content, send_status, retry_count, sent_at FROM recon_alert_log";
    }

    private RowMapper<AlertLogRow> alertLogMap() {
        return (rs, i) -> new AlertLogRow(rs.getLong("id"), rs.getString("scenario_code"),
                rs.getString("check_name"), rs.getString("detail_ids_json"), rs.getString("severity"),
                rs.getString("channel"), rs.getString("fingerprint"), rs.getString("content"),
                rs.getString("send_status"), rs.getInt("retry_count"), time(rs, "sent_at"));
    }

    private static String reconRunSelect() {
        return "SELECT id, scenario_code, status, matched_count, diff_count, resolved_count, "
                + "err_msg, started_at, finished_at FROM recon_run";
    }

    private RowMapper<ReconRunRow> reconRunMap() {
        return (rs, i) -> new ReconRunRow(rs.getLong("id"), rs.getString("scenario_code"),
                rs.getString("status"), rs.getInt("matched_count"), rs.getInt("diff_count"),
                rs.getInt("resolved_count"), rs.getString("err_msg"), time(rs, "started_at"),
                time(rs, "finished_at"));
    }

    private static String pullRunSelect() {
        return "SELECT id, ds_code, window_start::text, window_end::text, status, health_status, "
                + "row_count, insert_count, update_count, err_msg, started_at, finished_at "
                + "FROM recon_pull_run";
    }

    private RowMapper<PullRunRow> pullRunMap() {
        return (rs, i) -> new PullRunRow(rs.getLong("id"), rs.getString("ds_code"),
                String.valueOf(rs.getObject("window_start")), String.valueOf(rs.getObject("window_end")),
                rs.getString("status"), rs.getString("health_status"), rs.getInt("row_count"),
                rs.getInt("insert_count"), rs.getInt("update_count"), rs.getString("err_msg"),
                time(rs, "started_at"), time(rs, "finished_at"));
    }

    /** 追加文本等值条件，返回更新后的 first 标志。 */
    private static boolean textCond(StringBuilder sql, List<Object> args, boolean first,
                                    String col, String value) {
        if (StringUtils.hasText(value)) {
            sql.append(first ? " WHERE " : " AND ").append(col).append(" = ?");
            args.add(value);
            return false;
        }
        return first;
    }

    private static boolean timeCond(StringBuilder sql, List<Object> args, boolean first,
                                    String col, LocalDateTime value, String op) {
        if (value != null) {
            sql.append(first ? " WHERE " : " AND ").append(col).append(op).append(" ?");
            args.add(value);
            return false;
        }
        return first;
    }

    private <T> PageResult<T> queryPage(String baseSql, RowMapper<T> mapper,
                                        Object[] args, int page, int size) {
        Integer total = jdbcTemplate.queryForObject("SELECT COUNT(1) FROM (" + baseSql + ") t",
                Integer.class, args);
        Object[] pageArgs = Arrays.copyOf(args, args.length + 2);
        pageArgs[args.length] = size;
        pageArgs[args.length + 1] = (page - 1) * size;
        List<T> list = jdbcTemplate.query(baseSql + " LIMIT ? OFFSET ?", mapper, pageArgs);

        PageResult<T> r = new PageResult<>();
        r.setList(list);
        r.setTotal(total == null ? 0 : total);
        r.setPage(page);
        r.setSize(size);
        r.setPages((int) Math.ceil((total == null ? 0 : total) / (double) size));
        return r;
    }

    private static LocalDateTime time(ResultSet rs, String col) throws SQLException {
        Timestamp t = rs.getTimestamp(col);
        return t == null ? null : t.toLocalDateTime();
    }
}