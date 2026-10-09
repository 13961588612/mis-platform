package com.mis.adminbff.controller;

import com.mis.adminbff.client.TaskflowWebClient;
import com.mis.adminbff.support.TaskflowIdentity;
import com.mis.adminbff.client.model.AuditOpDetailVO;
import com.mis.adminbff.client.model.AuditOpVO;
import com.mis.adminbff.client.model.AuditStatsVO;
import com.mis.adminbff.client.model.AuditTimelineItem;
import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 业务操作审计对外 API（BFF 透传 mis-taskflow）。
 */
@RestController
@RequestMapping("/api/v1/audit-ops")
public class AuditOpController {

    private final TaskflowWebClient taskflowWebClient;

    public AuditOpController(TaskflowWebClient taskflowWebClient) {
        this.taskflowWebClient = taskflowWebClient;
    }

    @GetMapping
    public Result<PageResult<AuditOpVO>> search(
            @RequestParam(required = false) Long tenantId,
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) String module,
            @RequestParam(required = false) String operationType,
            @RequestParam(required = false) String businessType,
            @RequestParam(required = false) String resultStatus,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String startTime,
            @RequestParam(required = false) String endTime,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        return Result.ok(taskflowWebClient.auditOps(TaskflowIdentity.tenantId(tenantId), userId, module, operationType, businessType,
                resultStatus, keyword, startTime, endTime, page, size));
    }

    @GetMapping("/{id}")
    public Result<AuditOpDetailVO> detail(@PathVariable Long id, @RequestParam(required = false) Long tenantId) {
        return Result.ok(taskflowWebClient.auditOpDetail(id, TaskflowIdentity.tenantId(tenantId)));
    }

    @GetMapping("/timeline/{businessType}/{businessId}")
    public Result<List<AuditTimelineItem>> timeline(@PathVariable String businessType,
                                                    @PathVariable String businessId,
                                                    @RequestParam(required = false) Long tenantId) {
        return Result.ok(taskflowWebClient.auditTimeline(TaskflowIdentity.tenantId(tenantId), businessType, businessId));
    }

    @GetMapping("/stats")
    public Result<AuditStatsVO> stats(@RequestParam(required = false) Long tenantId,
                                      @RequestParam(defaultValue = "7") int days) {
        return Result.ok(taskflowWebClient.auditStats(TaskflowIdentity.tenantId(tenantId), days));
    }
}