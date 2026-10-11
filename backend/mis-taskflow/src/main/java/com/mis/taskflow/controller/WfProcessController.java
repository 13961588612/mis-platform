package com.mis.taskflow.controller;

import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import com.mis.taskflow.dto.CompleteWfTaskRequest;
import com.mis.taskflow.dto.ProcessDetailVO;
import com.mis.taskflow.dto.StartProcessRequest;
import com.mis.taskflow.dto.WfInstanceVO;
import com.mis.taskflow.service.ProcessService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 流程实例与任务处理内部 API（P5）。
 */
@RestController
@RequestMapping("/internal/v1/workflow")
public class WfProcessController {

    private final ProcessService processService;

    public WfProcessController(ProcessService processService) {
        this.processService = processService;
    }

    /** 启动流程实例。 */
    @PostMapping("/instances/start")
    public Result<Long> start(@RequestParam Long tenantId, @Valid @RequestBody StartProcessRequest request) {
        return Result.ok(processService.startProcess(tenantId, request));
    }

    /** 流程实例详情（ProcessShell 用）。 */
    @GetMapping("/instances/{id}")
    public Result<ProcessDetailVO> detail(@PathVariable Long id, @RequestParam Long tenantId) {
        return Result.ok(processService.detail(id, tenantId));
    }

    /** 我发起的流程（可含 keyword 模糊过滤；可选 appCode / scope 归属过滤，实例归属由 business_type 派生）。 */
    @GetMapping("/instances/my")
    public Result<PageResult<WfInstanceVO>> myInitiated(@RequestParam Long tenantId,
                                                        @RequestParam Long initiatorId,
                                                        @RequestParam(required = false) String status,
                                                        @RequestParam(required = false) String keyword,
                                                        @RequestParam(required = false) String appCode,
                                                        @RequestParam(required = false) String scope,
                                                        @RequestParam(defaultValue = "1") int page,
                                                        @RequestParam(defaultValue = "20") int size) {
        return Result.ok(processService.myInitiated(tenantId, initiatorId, status, keyword, appCode, scope, page, size));
    }

    /** 处理流程任务（同意/驳回）。 */
    @PostMapping("/tasks/{id}/complete")
    public Result<Void> complete(@PathVariable Long id,
                                 @RequestParam Long tenantId,
                                 @RequestParam(required = false) Long operatorId,
                                 @Valid @RequestBody CompleteWfTaskRequest request) {
        processService.completeTask(tenantId, id, request, operatorId);
        return Result.ok();
    }
}
