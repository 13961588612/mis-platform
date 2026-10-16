package com.mis.recon.controller;

import com.mis.recon.common.ApiResponse;
import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.common.PageResult;
import com.mis.recon.dao.DashboardDao;
import com.mis.recon.dao.DashboardDao.DiffAgingRow;
import com.mis.recon.dao.DashboardDao.DatasourceHealthRow;
import com.mis.recon.dao.DashboardDao.ReconTrendRow;
import com.mis.recon.dao.RunAuditDao;
import com.mis.recon.dao.RunAuditDao.AlertLogRow;
import com.mis.recon.dao.RunAuditDao.PullRunRow;
import com.mis.recon.dao.RunAuditDao.ReconRunRow;
import com.mis.recon.dao.RunAuditDao.ReportRunRow;
import com.mis.recon.dao.SummaryDao;
import com.mis.recon.domain.dto.BalanceResp;
import com.mis.recon.domain.dto.ReportDetailResp;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 运行/告警只读查询 + 监控统计 + 平衡表（T07 前端接入补充）：
 * report_run / alert_log / recon_run / pull_run 分页列表，数据源健康总览、
 * 对账 7 天趋势、差异池账龄分布、对账运行详情（consumed_seq_json）、平衡表（零差异证明）。
 */
@RestController
@RequestMapping("/internal/v1/recon")
@RequiredArgsConstructor
public class ObservabilityController {

    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final RunAuditDao runAuditDao;
    private final DashboardDao dashboardDao;
    private final SummaryDao summaryDao;
    private final ObjectMapper objectMapper;

    /**
     * 对账汇总：每 check 一行（对账汇总 R13~R15，v1.3 整体累计口径）。
     * <p>入参 scenarioCode / status 可选（runId 保留供调试，界面不暴露）；
     * 出参每 check 一行 {scenarioCode, checkName, strategy, latestRunId, latestRunTime,
     * runStatus, errMsg, total, success, diff, fail}，整体累计恒自洽 total = success + diff + fail；
     * 主数据源未配置 → total/success/diff/fail 为 null（前端显示「—」）。</p>
     */
    @GetMapping("/summary")
    public ApiResponse<List<SummaryDao.SummaryRow>> summary(
            @RequestParam(required = false) String scenarioCode,
            @RequestParam(required = false) Long runId,
            @RequestParam(required = false) String status) {
        return ApiResponse.ok(summaryDao.summary(scenarioCode, status));
    }

    @GetMapping("/report-runs")
    public ApiResponse<PageResult<ReportRunRow>> reportRuns(
            @RequestParam(required = false) String scenarioCode,
            @RequestParam(required = false) String reportType,
            @RequestParam(required = false) String sendStatus,
            @RequestParam(required = false) String dateFrom,
            @RequestParam(required = false) String dateTo,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        PageRequest pr = PageSupport.normalize(page, size);
        return ApiResponse.ok(runAuditDao.reportRuns(scenarioCode, reportType, sendStatus,
                parseOrNull(dateFrom), parseOrNull(dateTo), pr.getPageNumber() + 1, pr.getPageSize()));
    }

    @GetMapping("/alert-logs")
    public ApiResponse<PageResult<AlertLogRow>> alertLogs(
            @RequestParam(required = false) String scenarioCode,
            @RequestParam(required = false) String severity,
            @RequestParam(required = false) String channel,
            @RequestParam(required = false) String dateFrom,
            @RequestParam(required = false) String dateTo,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        PageRequest pr = PageSupport.normalize(page, size);
        return ApiResponse.ok(runAuditDao.alertLogs(scenarioCode, severity, channel,
                parseOrNull(dateFrom), parseOrNull(dateTo), pr.getPageNumber() + 1, pr.getPageSize()));
    }

    @GetMapping("/recon-runs")
    public ApiResponse<PageResult<ReconRunRow>> reconRuns(
            @RequestParam(required = false) String scenarioCode,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String dateFrom,
            @RequestParam(required = false) String dateTo,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        PageRequest pr = PageSupport.normalize(page, size);
        return ApiResponse.ok(runAuditDao.reconRuns(scenarioCode, status,
                parseOrNull(dateFrom), parseOrNull(dateTo), pr.getPageNumber() + 1, pr.getPageSize()));
    }

    @GetMapping("/pull-runs")
    public ApiResponse<PageResult<PullRunRow>> pullRuns(
            @RequestParam(required = false) String dsCode,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String healthStatus,
            @RequestParam(required = false) String dateFrom,
            @RequestParam(required = false) String dateTo,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        PageRequest pr = PageSupport.normalize(page, size);
        return ApiResponse.ok(runAuditDao.pullRuns(dsCode, status, healthStatus,
                parseOrNull(dateFrom), parseOrNull(dateTo), pr.getPageNumber() + 1, pr.getPageSize()));
    }

    /**
     * 报告详情：运行记录 + 该次运行发送的报告正文。
     * <p>alert_log 未落 report_run_id，按 scenario + 运行时间窗口关联；运行记录不存在返回 1002。</p>
     */
    @GetMapping("/report-runs/{id}/detail")
    public ApiResponse<ReportDetailResp> reportRunDetail(@PathVariable long id) {
        ReportRunRow run = runAuditDao.reportRunById(id);
        if (run == null) {
            throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, "报告运行记录不存在: " + id);
        }
        List<AlertLogRow> alerts = runAuditDao.reportRunAlerts(run.scenarioCode(), run.startedAt(), run.finishedAt());
        List<DashboardDao.ReportCheckSummary> summaries = dashboardDao.reportCheckSummary(
                alerts.stream().flatMap(a -> parseDetailIds(a.detailIdsJson()).stream()).distinct().toList());
        return ApiResponse.ok(new ReportDetailResp(run, alerts, summaries));
    }

    /** 数据源健康总览卡片（运行监控）。 */
    @GetMapping("/health-overview")
    public ApiResponse<List<DatasourceHealthRow>> healthOverview() {
        return ApiResponse.ok(dashboardDao.datasourceHealth());
    }

    /** 对账成功率趋势：近 days 天按日堆叠（成功/跳过/失败）。 */
    @GetMapping("/recon-trend")
    public ApiResponse<List<ReconTrendRow>> reconTrend(@RequestParam(defaultValue = "7") int days) {
        return ApiResponse.ok(dashboardDao.reconTrend(Math.min(Math.max(days, 1), 30)));
    }

    /** 差异池账龄分布（first_seen_at 分桶，超 30 天标红）。 */
    @GetMapping("/diff-aging")
    public ApiResponse<List<DiffAgingRow>> diffAging() {
        return ApiResponse.ok(dashboardDao.diffAging());
    }

    /** 对账运行详情（含 consumed_seq_json 消费进度），不存在返回 1002。 */
    @GetMapping("/recon-runs/{id}/detail")
    public ApiResponse<DashboardDao.ReconRunDetailRow> reconRunDetail(@PathVariable long id) {
        DashboardDao.ReconRunDetailRow run = dashboardDao.reconRunById(id);
        if (run == null) {
            throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, "对账运行记录不存在: " + id);
        }
        return ApiResponse.ok(run);
    }

    /**
     * 平衡表（零差异证明）：按场景输出覆盖窗口/覆盖轮次/平衡结论/数据源健康/对账结果/本期变动/轮次完整性。
     *
     * @param date 指定日期 yyyy-MM-dd（报告中心 R87 参数化，默认最近一次由前端给值）；
     *             date 为空时回退 days 窗口语义
     * @param days 统计窗口天数（默认 1 = 当日窗口，最大 30）
     */
    @GetMapping("/balance")
    public ApiResponse<BalanceResp> balance(
            @RequestParam String scenarioCode,
            @RequestParam(required = false) String date,
            @RequestParam(defaultValue = "1") int days) {
        int d = Math.min(Math.max(days, 1), 30);
        LocalDateTime windowStart;
        LocalDateTime windowEnd;
        if (StringUtils.hasText(date)) {
            try {
                LocalDate day = LocalDate.parse(date.trim(), DateTimeFormatter.ISO_LOCAL_DATE);
                windowStart = day.atStartOfDay();
                windowEnd = day.plusDays(1).atStartOfDay().minusNanos(1);
            } catch (DateTimeParseException e) {
                throw new BizException(ErrorCode.REQUEST_BODY_INVALID,
                        "日期格式应为 yyyy-MM-dd（当前: " + date + "）");
            }
        } else {
            LocalDateTime now = LocalDateTime.now();
            windowStart = now.minusDays(d - 1L).withHour(0).withMinute(0).withSecond(0).withNano(0);
            windowEnd = now;
        }

        // 覆盖轮次 / 完整性：窗口内 recon_run 按状态计数
        List<Object[]> statusCounts = dashboardDao.runStatusCounts(scenarioCode, windowStart, windowEnd);
        Map<String, Long> byStatus = new LinkedHashMap<>();
        for (Object[] row : statusCounts) {
            byStatus.merge((String) row[0], (Long) row[1], Long::sum);
        }
        long success = byStatus.getOrDefault("success", 0L);
        long skipped = byStatus.getOrDefault("skipped", 0L);
        long failed = byStatus.getOrDefault("failed", 0L);
        long total = statusCounts.stream().mapToLong(r -> (Long) r[1]).sum();

        // 窗口内最近成功轮：平衡结论 + matched/resolved（随所选日期联动，2026-08-29 口径）
        DashboardDao.ReconRunDetailRow latest =
                dashboardDao.latestSuccessRunInWindow(scenarioCode, windowStart, windowEnd);

        // 窗口结束时刻差异池（期末池口径，按 diff_type 分布 + 总数）
        Map<String, Long> diffTypes = dashboardDao.poolCountsAtWindow(scenarioCode, windowEnd);
        long endPool = diffTypes.values().stream().mapToLong(Long::longValue).sum();

        String conclusion;
        String conclusionText;
        if (latest == null) {
            conclusion = "no_run";
            conclusionText = total > 0
                    ? "窗口内无成功对账轮次（skipped/failed " + (skipped + failed) + " 轮），无法出具平衡证明"
                    : "所选日期窗口内无对账轮次，暂无法出具平衡证明";
        } else if (endPool == 0) {
            conclusion = "balanced";
            conclusionText = scenarioCode + " 于 " + windowStart.toLocalDate() + " 全量窗口对平，无待处理差异";
        } else {
            conclusion = "unbalanced";
            conclusionText = scenarioCode + " 于 " + windowStart.toLocalDate() + " 存在 "
                    + endPool + " 条待处理差异，未对平";
        }

        // 对账结果：窗口内最近成功轮 matched/resolved + 窗口期末池按 diff_type 分布
        long matched = latest == null ? 0 : Math.max(latest.matchedCount(), 0);
        long resolved = latest == null ? 0 : Math.max(latest.resolvedCount(), 0);

        BalanceResp resp = BalanceResp.builder()
                .scenarioCode(scenarioCode)
                .windowStart(windowStart)
                .windowEnd(windowEnd)
                .coveredRounds((int) success)
                .totalRounds((int) total)
                .conclusion(conclusion)
                .conclusionText(conclusionText)
                .datasourceHealth(dashboardDao.datasourceHealthInWindow(scenarioCode, windowStart, windowEnd))
                .matchedCount(matched)
                .fieldMismatch(diffTypes.getOrDefault("field_mismatch", 0L))
                .unmatchedLeft(diffTypes.getOrDefault("unmatched_left", 0L))
                .unmatchedRight(diffTypes.getOrDefault("unmatched_right", 0L))
                .anomaly(diffTypes.getOrDefault("anomaly", 0L))
                .resolvedCount(resolved)
                .newDiff(dashboardDao.countByTimeCol(scenarioCode, "first_seen_at", windowStart, windowEnd))
                .resolvedDiff(dashboardDao.countByTimeCol(scenarioCode, "resolved_at", windowStart, windowEnd))
                .endPoolCount(endPool)
                .skippedRounds(skipped)
                .failedRounds(failed)
                .build();
        return ApiResponse.ok(resp);
    }

    private LocalDateTime parseOrNull(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return LocalDateTime.parse(value, TIME_FMT);
        } catch (DateTimeParseException e) {
            throw new BizException(ErrorCode.REQUEST_BODY_INVALID,
                    "时间格式应为 yyyy-MM-dd HH:mm:ss（当前: " + value + "）");
        }
    }

    /** 解析 alert_log.detail_ids_json（JSONB 数组，如 "[83]"），解析失败返回空。 */
    private List<Long> parseDetailIds(String detailIdsJson) {
        if (detailIdsJson == null || detailIdsJson.isBlank()) {
            return List.of();
        }
        try {
            return objectMapper.readValue(detailIdsJson, new TypeReference<List<Long>>() {});
        } catch (Exception e) {
            return new ArrayList<>();
        }
    }
}