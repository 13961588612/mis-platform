package com.mis.taskflow.controller;

import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import com.mis.taskflow.dto.ExecutionTaskVO;
import com.mis.taskflow.service.ExecutionTaskService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 后置执行监控与人工干预内部 API（P6）。
 */
@RestController
@RequestMapping("/internal/v1/exec-monitor")
public class ExecutionMonitorController {

    private final ExecutionTaskService executionTaskService;

    public ExecutionMonitorController(ExecutionTaskService executionTaskService) {
        this.executionTaskService = executionTaskService;
    }

    /** 执行监控列表。 */
    @GetMapping
    public Result<PageResult<ExecutionTaskVO>> list(@RequestParam Long tenantId,
                                                     @RequestParam(required = false) String status,
                                                     @RequestParam(defaultValue = "1") int page,
                                                     @RequestParam(defaultValue = "20") int size) {
        return Result.ok(executionTaskService.monitor(tenantId, status, page, size));
    }

    /** 任务详情（含错误信息）。 */
    @GetMapping("/{id}")
    public Result<ExecutionTaskVO> detail(@PathVariable Long id, @RequestParam Long tenantId) {
        return Result.ok(executionTaskService.taskDetail(id, tenantId));
    }

    /** 手动重试。 */
    @PostMapping("/{id}/retry")
    public Result<Void> retry(@PathVariable Long id, @RequestParam Long tenantId) {
        executionTaskService.manualRetry(id, tenantId);
        return Result.ok();
    }

    /** 强制归档（跳过自动执行）。 */
    @PostMapping("/{id}/force-archive")
    public Result<Void> forceArchive(@PathVariable Long id, @RequestParam Long tenantId) {
        executionTaskService.forceArchive(id, tenantId);
        return Result.ok();
    }

    /** 立即扫描一次（运维手动触发）。 */
    @PostMapping("/scan")
    public Result<Integer> scan() {
        return Result.ok(executionTaskService.scanAndExecute());
    }
}