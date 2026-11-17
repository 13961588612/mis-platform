package com.mis.recon.controller;

import com.mis.recon.common.ApiResponse;
import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.domain.dto.FetchOneReq;
import com.mis.recon.domain.dto.FetchOneResp;
import com.mis.recon.domain.dto.ProbeResp;
import com.mis.recon.domain.dto.PullReq;
import com.mis.recon.domain.dto.PullResultResp;
import com.mis.recon.domain.dto.RebuildResp;
import com.mis.recon.domain.dto.ReportTriggerResp;
import com.mis.recon.domain.dto.SqlTestReq;
import com.mis.recon.domain.dto.SqlTestResp;
import com.mis.recon.service.ops.DatasourceRebuildService;
import com.mis.recon.service.pull.PullRunner;
import com.mis.recon.service.pull.ReconRunner;
import com.mis.recon.service.report.ReportRunner;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Map;

/**
 * 运维操作端点（F118）：手动拉取 / fetch_one 单条重拉 / 试拉（BR-18）/ 手动对账（T05 §12）。
 */
@RestController
@RequestMapping("/internal/v1/recon/ops")
@RequiredArgsConstructor
public class OpsController {

    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final PullRunner pullRunner;
    private final ReconRunner reconRunner;
    private final ReportRunner reportRunner;
    private final DatasourceRebuildService datasourceRebuildService;

    /** 手动拉取（G8：同步执行返回 pull_run 摘要）；body 可选 {start, end} 覆盖窗口。 */
    @PostMapping("/pull/{dsCode}")
    public ApiResponse<PullResultResp> pull(@PathVariable String dsCode,
                                            @RequestBody(required = false) @Valid PullReq req) {
        LocalDateTime start = req != null ? parseOrNull(req.getStart()) : null;
        LocalDateTime end = req != null ? parseOrNull(req.getEnd()) : null;
        long runId = pullRunner.run(dsCode, start, end);
        return ApiResponse.ok(new PullResultResp(runId, "accepted", null, 0));
    }

    /** 手动触发对账（T05 §12，G11 running map 互斥）：同步执行返回 run id；body 可选 {start, end} 覆盖 time_window 检查窗口。 */
    @PostMapping("/recon/{scenarioCode}")
    public ApiResponse<PullResultResp> recon(@PathVariable String scenarioCode,
                                             @RequestBody(required = false) @Valid PullReq req) {
        LocalDateTime start = req != null ? parseOrNull(req.getStart()) : null;
        LocalDateTime end = req != null ? parseOrNull(req.getEnd()) : null;
        long runId = reconRunner.run(scenarioCode, start, end);
        return ApiResponse.ok(new PullResultResp(runId, "accepted", null, 0));
    }

    /** fetch_one 单条重拉（G7：不写 pull_run）。 */
    @PostMapping("/fetch-one/{dsCode}")
    public ApiResponse<FetchOneResp> fetchOne(@PathVariable String dsCode,
                                              @Valid @RequestBody FetchOneReq req) {
        Map<String, Object> result = pullRunner.fetchOne(dsCode, req.getRecordKey());
        boolean found = Boolean.TRUE.equals(result.get("found"));
        return ApiResponse.ok(new FetchOneResp(found, req.getRecordKey()));
    }

    /** 试拉（BR-18）：小窗口取数返回样例，不写台账。 */
    @PostMapping("/probe/{dsCode}")
    public ApiResponse<ProbeResp> probe(@PathVariable String dsCode) {
        return ApiResponse.ok(pullRunner.probe(dsCode));
    }

    /** 取数 SQL 检测：表单未保存的临时 SQL（conn_code + sql），试跑返回列/样例行/错误。 */
    @PostMapping("/sql-test")
    public ApiResponse<SqlTestResp> sqlTest(@Valid @RequestBody SqlTestReq req) {
        return ApiResponse.ok(pullRunner.sqlTest(
                req.getConnCode(), req.getSql(),
                parseOrNull(req.getStart()), parseOrNull(req.getEnd()),
                req.getLimit()));
    }

    /** 手动触发报告（T07-spec §9）：同步执行返回 run 摘要。 */
    @PostMapping("/report/{scenarioCode}")
    public ApiResponse<ReportTriggerResp> report(@PathVariable String scenarioCode) {
        return ApiResponse.ok(reportRunner.run(scenarioCode));
    }

    /** 数据源重建（破坏性）：清空该数据源台账/水位 + 引用它的 check 的游标/索引/差异，再全量重拉。 */
    @PostMapping("/datasource/{dsCode}/rebuild")
    public ApiResponse<RebuildResp> rebuild(@PathVariable String dsCode,
                                            @RequestBody(required = false) @Valid PullReq req) {
        LocalDateTime start = req != null ? parseOrNull(req.getStart()) : null;
        LocalDateTime end = req != null ? parseOrNull(req.getEnd()) : null;
        return ApiResponse.ok(datasourceRebuildService.rebuild(dsCode, start, end));
    }

    @PostMapping("/report/{scenarioCode}/resend")
    public ApiResponse<ReportTriggerResp> resend(@PathVariable String scenarioCode) {
        return ApiResponse.ok(reportRunner.run(scenarioCode));
    }

    private LocalDateTime parseOrNull(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return LocalDateTime.parse(value, TIME_FMT);
        } catch (java.time.format.DateTimeParseException e) {
            throw new BizException(
                    ErrorCode.REQUEST_BODY_INVALID,
                    "时间格式应为 yyyy-MM-dd HH:mm:ss（当前: " + value + "）");
        }
    }
}
