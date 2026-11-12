package com.mis.taskflow.controller;

import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import com.mis.taskflow.dto.AuditOpDetailVO;
import com.mis.taskflow.dto.AuditOpVO;
import com.mis.taskflow.dto.AuditStatsVO;
import com.mis.taskflow.dto.AuditTimelineItem;
import com.mis.taskflow.service.AuditOpService;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.io.PrintWriter;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 业务操作审计内部 API（BFF 透传）。
 */
@RestController
@RequestMapping("/internal/v1/audit-ops")
public class AuditOpController {

    private final AuditOpService auditOpService;

    public AuditOpController(AuditOpService auditOpService) {
        this.auditOpService = auditOpService;
    }

    @GetMapping
    public Result<PageResult<AuditOpVO>> search(
            @RequestParam Long tenantId,
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) String module,
            @RequestParam(required = false) String operationType,
            @RequestParam(required = false) String businessType,
            @RequestParam(required = false) String resultStatus,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime startTime,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime endTime,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        return Result.ok(auditOpService.search(tenantId, userId, module, operationType, businessType,
                resultStatus, keyword, startTime, endTime, page, size));
    }

    @GetMapping("/{id}")
    public Result<AuditOpDetailVO> detail(@PathVariable Long id, @RequestParam Long tenantId) {
        return Result.ok(auditOpService.detail(id, tenantId));
    }

    @GetMapping("/timeline/{businessType}/{businessId}")
    public Result<List<AuditTimelineItem>> timeline(@PathVariable String businessType,
                                                    @PathVariable String businessId,
                                                    @RequestParam Long tenantId) {
        return Result.ok(auditOpService.timeline(tenantId, businessType, businessId));
    }

    @GetMapping("/stats")
    public Result<AuditStatsVO> stats(@RequestParam Long tenantId,
                                      @RequestParam(defaultValue = "7") int days) {
        return Result.ok(auditOpService.stats(tenantId, days));
    }

    /** CSV 导出（UTF-8 BOM，Excel 友好）。 */
    @GetMapping("/export")
    public void export(@RequestParam Long tenantId,
                       @RequestParam(required = false) String module,
                       @RequestParam(required = false) String operationType,
                       @RequestParam(required = false) String businessType,
                       @RequestParam(required = false) String resultStatus,
                       @RequestParam(required = false) String keyword,
                       HttpServletResponse response) throws IOException {
        List<AuditOpVO> rows = auditOpService.search(tenantId, null, module, operationType, businessType,
                resultStatus, keyword, null, null, 1, 200).getList();

        response.setContentType("text/csv;charset=UTF-8");
        response.setCharacterEncoding("UTF-8");
        response.setHeader("Content-Disposition", "attachment; filename=audit-ops.csv");
        PrintWriter w = response.getWriter();
        w.write('\uFEFF'); // UTF-8 BOM
        w.println("时间,用户,模块,操作,业务类型,业务ID,描述,结果,耗时(ms)");
        for (AuditOpVO r : rows) {
            w.println(csv(r.operTime() == null ? "" : r.operTime().toString()) + ","
                    + csv(r.username()) + "," + csv(r.module()) + "," + csv(r.operationType()) + ","
                    + csv(r.businessType()) + "," + csv(r.businessId()) + "," + csv(r.description()) + ","
                    + csv(r.resultStatus()) + "," + (r.durationMs() == null ? "" : r.durationMs()));
        }
        w.flush();
    }

    private static String csv(String v) {
        if (v == null) {
            return "";
        }
        String escaped = v.replace("\"", "\"\"");
        return v.contains(",") || v.contains("\"") || v.contains("\n") ? "\"" + escaped + "\"" : escaped;
    }
}