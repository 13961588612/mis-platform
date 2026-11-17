package com.mis.recon.service.report;

import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.dao.ReportDao;
import com.mis.recon.dao.ReportDao.ReportRow;
import com.mis.recon.domain.config.ReconReporterConfig;
import com.mis.recon.domain.config.ReconScenario;
import com.mis.recon.domain.dto.ReportTriggerResp;
import com.mis.recon.repository.ScenarioRepository;
import com.mis.recon.service.alert.AlertLogService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 报告引擎（F103，T07-spec §3.1）：扫 confirmed & 未报告 & 未处理差异 → 按 check 聚合 →
 * 渠道发送 → alert_log 留痕（指纹去重）→ 成功后回填 reported_at。
 * 门禁：本类仅依赖 dao / repository（读配置快照）+ domain，不注入引擎热路径。
 */
@Slf4j
@Component
public class ReportRunner {

    private final ReportDao reportDao;
    private final AlertLogService alertLogService;
    private final ReporterFactory reporterFactory;
    private final ReporterService reporterService;
    private final ScenarioRepository scenarioRepository;
    private final ReportRenderer renderer = new ReportRenderer();
    private final TransactionTemplate txTemplate;

    public ReportRunner(ReportDao reportDao, AlertLogService alertLogService,
                        ReporterFactory reporterFactory, ReporterService reporterService,
                        ScenarioRepository scenarioRepository, PlatformTransactionManager txManager) {
        this.reportDao = reportDao;
        this.alertLogService = alertLogService;
        this.reporterFactory = reporterFactory;
        this.reporterService = reporterService;
        this.scenarioRepository = scenarioRepository;
        this.txTemplate = new TransactionTemplate(txManager);
    }

    /** 触发一次场景报告（手动 / ReportJob 共用）。 */
    public ReportTriggerResp run(String scenarioCode) {
        ReconScenario scenario = scenarioRepository.findByScenarioCode(scenarioCode)
                .orElseThrow(() -> new BizException(ErrorCode.SCENARIO_NOT_FOUND));
        long reportRunId = reportDao.insertReportRun(scenarioCode, scenario.getReportType());
        List<ReportRow> rows = reportDao.scanForReport(scenarioCode);
        if (rows.isEmpty()) {
            reportDao.finishReportRun(reportRunId, "success", 0, 0, null);
            return resp(reportRunId, 0, "success");
        }
        String scenarioName = StringUtils.hasText(scenario.getName()) ? scenario.getName() : scenarioCode;
        Map<String, List<ReportRow>> groups = groupByCheck(rows);

        int diffCount = rows.size();
        // 差异金额合计（分，报告中心 R84 diff_amount_sum 落列）
        long diffAmountSum = rows.stream()
                .mapToLong(r -> r.diffAmountCent == null ? 0 : r.diffAmountCent)
                .sum();
        int successGroups = 0;
        List<String> errors = new ArrayList<>();
        for (Map.Entry<String, List<ReportRow>> e : groups.entrySet()) {
            GroupResult gr = processGroup(scenarioCode, scenarioName, e.getKey(), e.getValue());
            if (gr.success) {
                successGroups++;
            }
            if (gr.error != null) {
                errors.add(gr.error);
            }
        }
        String sendStatus = errors.isEmpty() ? "success" : successGroups == 0 ? "failed" : "partial";
        reportDao.finishReportRun(reportRunId, sendStatus, diffCount, diffAmountSum,
                errors.isEmpty() ? null : String.join("; ", errors));
        log.info("[report] scenario={} runId={} diffCount={} sendStatus={}", scenarioCode, reportRunId, diffCount, sendStatus);
        return resp(reportRunId, diffCount, sendStatus);
    }

    /** 单 check 处理：渲染 → 路由 → 去重 → 发送 → 留痕/回填。 */
    private GroupResult processGroup(String scenarioCode, String scenarioName,
                                     String checkName, List<ReportRow> rows) {
        List<ReportRenderer.ReportRowView> views = rows.stream()
                .map(r -> new ReportRenderer.ReportRowView(r.id, r.matchKeyDisplay, r.diffType,
                        r.diffDesc, r.diffAmountCent, r.diffPoint))
                .toList();
        ReportContent content = renderer.render(scenarioCode, scenarioName, checkName, views);
        ReconReporterConfig route = reporterService.resolve(scenarioCode, checkName);
        if (route != null && below(route.getMinSeverity(), content.getSeverity())) {
            log.info("[report] group severity below min, skip send: check={} severity={} min={}",
                    checkName, content.getSeverity(), route.getMinSeverity());
            return GroupResult.skip();
        }
        String fingerprint = alertLogService.fingerprint(scenarioCode, checkName,
                content.getDetailIds(), content.getSeverity());
        if (alertLogService.exists(fingerprint)) {
            log.info("[report] fingerprint dup, skip send: check={}", checkName);
            return GroupResult.skip();
        }
        String channel = route == null ? null : route.getChannel();
        ReportContent withCfg = route == null ? content : content.withConfig(route.getConfigJson());
        SendResult result = reporterFactory.get(channel).send(withCfg);

        if (result.isSuccess()) {
            txTemplate.execute(status -> {
                alertLogService.record(scenarioCode, checkName, content.getDetailIds(),
                        content.getSeverity(), channel, fingerprint, content.getBody(), "success", null);
                reportDao.markReported(content.getDetailIds());
                return null;
            });
            return GroupResult.ok();
        }
        txTemplate.execute(status -> {
            alertLogService.record(scenarioCode, checkName, content.getDetailIds(),
                    content.getSeverity(), channel, fingerprint, content.getBody(), "failed", result.getError());
            return null;
        });
        return GroupResult.fail(checkName + ": " + result.getError());
    }

    private static Map<String, List<ReportRow>> groupByCheck(List<ReportRow> rows) {
        Map<String, List<ReportRow>> groups = new LinkedHashMap<>();
        for (ReportRow r : rows) {
            groups.computeIfAbsent(r.checkName, k -> new ArrayList<>()).add(r);
        }
        return groups;
    }

    private static boolean below(String minSeverity, String severity) {
        if (!StringUtils.hasText(minSeverity)) {
            return false;
        }
        return rank(severity) < rank(minSeverity);
    }

    private static int rank(String severity) {
        if (severity == null) {
            return 0;
        }
        return switch (severity) {
            case "critical" -> 2;
            case "warn" -> 1;
            default -> 0;
        };
    }

    private static ReportTriggerResp resp(long reportRunId, int diffCount, String sendStatus) {
        ReportTriggerResp resp = new ReportTriggerResp();
        resp.setReportRunId(reportRunId);
        resp.setDiffCount(diffCount);
        resp.setSendStatus(sendStatus);
        return resp;
    }

    /** 组处理结果 */
    private static final class GroupResult {
        final boolean success;
        final String error;

        private GroupResult(boolean success, String error) {
            this.success = success;
            this.error = error;
        }

        static GroupResult ok() {
            return new GroupResult(true, null);
        }

        static GroupResult skip() {
            return new GroupResult(true, null);
        }

        static GroupResult fail(String error) {
            return new GroupResult(false, error);
        }
    }
}