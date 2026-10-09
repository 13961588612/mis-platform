package com.mis.adminbff.controller;

import com.mis.adminbff.client.TaskflowWebClient;
import com.mis.adminbff.support.TaskflowIdentity;
import com.mis.adminbff.client.model.ExecutionTaskVO;
import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 后置执行监控对外 API（BFF 透传 mis-taskflow）。
 */
@RestController
@RequestMapping("/api/v1/exec-monitor")
public class ExecutionMonitorController {

    private final TaskflowWebClient taskflowWebClient;

    public ExecutionMonitorController(TaskflowWebClient taskflowWebClient) {
        this.taskflowWebClient = taskflowWebClient;
    }

    @GetMapping
    public Result<PageResult<ExecutionTaskVO>> list(@RequestParam(required = false) Long tenantId,
                                                    @RequestParam(required = false) String status,
                                                    @RequestParam(defaultValue = "1") int page,
                                                    @RequestParam(defaultValue = "20") int size) {
        return Result.ok(taskflowWebClient.execMonitor(TaskflowIdentity.tenantId(tenantId), status, page, size));
    }

    @GetMapping("/{id}")
    public Result<ExecutionTaskVO> detail(@PathVariable Long id, @RequestParam(required = false) Long tenantId) {
        return Result.ok(taskflowWebClient.execTask(id, TaskflowIdentity.tenantId(tenantId)));
    }

    @PostMapping("/{id}/retry")
    public Result<Void> retry(@PathVariable Long id, @RequestParam(required = false) Long tenantId) {
        taskflowWebClient.execRetry(id, TaskflowIdentity.tenantId(tenantId));
        return Result.ok();
    }

    @PostMapping("/{id}/force-archive")
    public Result<Void> forceArchive(@PathVariable Long id, @RequestParam(required = false) Long tenantId) {
        taskflowWebClient.execForceArchive(id, TaskflowIdentity.tenantId(tenantId));
        return Result.ok();
    }

    @PostMapping("/scan")
    public Result<Integer> scan() {
        return Result.ok(taskflowWebClient.execScan());
    }
}