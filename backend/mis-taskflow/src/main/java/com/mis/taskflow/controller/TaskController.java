package com.mis.taskflow.controller;

import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import com.mis.taskflow.dto.BatchHandleTaskRequest;
import com.mis.taskflow.dto.CreateTaskRequest;
import com.mis.taskflow.dto.HandleTaskRequest;
import com.mis.taskflow.dto.TaskStatsVO;
import com.mis.taskflow.dto.TaskVO;
import com.mis.taskflow.dto.TransferTaskRequest;
import com.mis.taskflow.service.TaskService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 代办任务内部 API（BFF 透传）。
 *
 * <p>租户/用户维度暂以查询参数显式传入；P3 接入认证上下文后改为从 LoginUser 取。
 */
@RestController
@RequestMapping("/internal/v1/tasks")
public class TaskController {

    private final TaskService taskService;

    public TaskController(TaskService taskService) {
        this.taskService = taskService;
    }

    /** 创建代办（业务服务调用；可按需同时生成关联通知）。 */
    @PostMapping
    public Result<Long> create(@RequestParam Long tenantId,
                               @RequestParam(required = false) Long operatorId,
                               @Valid @RequestBody CreateTaskRequest request) {
        return Result.ok(taskService.createTask(tenantId, operatorId, request));
    }

    /** 我的待办（可含 keyword 模糊过滤；可选 appCode / scope 归属过滤）。 */
    @GetMapping("/my")
    public Result<PageResult<TaskVO>> my(@RequestParam Long tenantId,
                                         @RequestParam Long assigneeId,
                                         @RequestParam(required = false) String status,
                                         @RequestParam(required = false) String keyword,
                                         @RequestParam(required = false) String appCode,
                                         @RequestParam(required = false) String scope,
                                         @RequestParam(defaultValue = "1") int page,
                                         @RequestParam(defaultValue = "20") int size) {
        return Result.ok(taskService.myTasks(tenantId, assigneeId, status, keyword, appCode, scope, page, size));
    }

    /** 我处理过的（已通过 / 已驳回；可含 keyword 模糊过滤；可选 appCode / scope 归属过滤）。 */
    @GetMapping("/handled")
    public Result<PageResult<TaskVO>> handled(@RequestParam Long tenantId,
                                              @RequestParam Long assigneeId,
                                              @RequestParam(required = false) String keyword,
                                              @RequestParam(required = false) String appCode,
                                              @RequestParam(required = false) String scope,
                                              @RequestParam(defaultValue = "1") int page,
                                              @RequestParam(defaultValue = "20") int size) {
        return Result.ok(taskService.handledTasks(tenantId, assigneeId, keyword, appCode, scope, page, size));
    }

    /** 待办统计。 */
    @GetMapping("/stats")
    public Result<TaskStatsVO> stats(@RequestParam Long tenantId, @RequestParam Long assigneeId) {
        return Result.ok(taskService.stats(tenantId, assigneeId));
    }

    /** 处理代办（同意/驳回/完成）。 */
    @PostMapping("/{id}/handle")
    public Result<Void> handle(@PathVariable Long id,
                               @RequestParam Long tenantId,
                               @RequestParam(required = false) Long operatorId,
                               @Valid @RequestBody HandleTaskRequest request) {
        taskService.handleTask(tenantId, id, request, operatorId);
        return Result.ok();
    }

    /** 转办。 */
    @PostMapping("/{id}/transfer")
    public Result<Void> transfer(@PathVariable Long id,
                                 @RequestParam Long tenantId,
                                 @RequestParam(required = false) Long operatorId,
                                 @Valid @RequestBody TransferTaskRequest request) {
        taskService.transferTask(tenantId, id, request, operatorId);
        return Result.ok();
    }

    /** 批量处理。 */
    @PostMapping("/batch-handle")
    public Result<Integer> batchHandle(@RequestParam Long tenantId,
                                       @RequestParam(required = false) Long operatorId,
                                       @Valid @RequestBody BatchHandleTaskRequest request) {
        return Result.ok(taskService.batchHandle(tenantId, request, operatorId));
    }
}