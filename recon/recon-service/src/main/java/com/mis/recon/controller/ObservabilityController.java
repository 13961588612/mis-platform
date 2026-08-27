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
import com.mis.recon.domain.dto.BalanceResp;
import com.mis.recon.domain.dto.ReportDetailResp;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

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
    private final ObjectMapper objectMapper;

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
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        PageRequest pr = PageSupport.normalize(page, size);
        return ApiResponse.ok(runAuditDao.alertLogs(scenarioCode, severity, channel,
                pr.getPageNumber() + 1, pr.getPageSize()));
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
     * @param days 统计窗口天数（默认 1 = 当日窗口，最大 30）
     */
    @GetMapping("/balance")
    public ApiResponse<BalanceResp> balance(
            @RequestParam String scenarioCode,
            @RequestParam(defaultValue = "1") int days) {
        int d = Math.min(Math.max(days, 1), 30);
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime windowStart = now.minusDays(d - 1L).withHour(0).withMinute(0).withSecond(0).withNano(0);
        LocalDateTime windowEnd = now;

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

        // 最近成功轮：平衡结论 + matched/resolved
        DashboardDao.ReconRunDetailRow latest = dashboardDao.latestSuccessRun(scenarioCode);
        boolean balanced = latest != null && latest.diffCount() == 0;
        String conclusion;
        String conclusionText;
        if (latest == null) {
            conclusion = "no_run";
            conclusionText = "无成功对账轮次，暂无法出具平衡证明";
        } else if (balanced) {
            conclusion = "balanced";
            conclusionText = latest.scenarioCode() + " 最近一次对账于 "
                    + (latest.finishedAt() == null ? "-" : latest.finishedAt().format(TIME_FMT))
                    + " 对平，差异池 "
                    + dashboardDao.countPool(scenarioCode) + " 条待处理";
        } else {
            conclusion = "unbalanced";
            conclusionText = latest.scenarioCode() + " 最近一次对账存在 "
                    + latest.diffCount() + " 条差异未对平";
        }

        // 对账结果：最近成功轮 matched/resolved + 当前池按 diff_type 分布
        long matched = latest == null ? 0 : Math.max(latest.matchedCount(), 0);
        long resolved = latest == null ? 0 : Math.max(latest.resolvedCount(), 0);
        Map<String, Long> diffTypes = dashboardDao.diffTypeCounts(scenarioCode);

        BalanceResp resp = BalanceResp.builder()
                .scenarioCode(scenarioCode)
                .windowStart(windowStart)
                .windowEnd(windowEnd)
                .coveredRounds((int) success)
                .totalRounds((int) total)
                .conclusion(conclusion)
                .conclusionText(conclusionText)
                .datasourceHealth(dashboardDao.datasourceHealth())
                .matchedCount(matched)
                .fieldMismatch(diffTypes.getOrDefault("field_mismatch", 0L))
                .unmatchedLeft(diffTypes.getOrDefault("unmatched_left", 0L))
                .unmatchedRight(diffTypes.getOrDefault("unmatched_right", 0L))
                .anomaly(diffTypes.getOrDefault("anomaly", 0L))
                .resolvedCount(resolved)
                .newDiff(dashboardDao.countByTimeCol(scenarioCode, "first_seen_at", windowStart, windowEnd))
                .resolvedDiff(dashboardDao.countByTimeCol(scenarioCode, "resolved_at", windowStart, windowEnd))
                .endPoolCount(dashboardDao.countPool(scenarioCode))
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