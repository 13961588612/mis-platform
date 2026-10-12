package com.mis.taskflow.controller;

import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import com.mis.taskflow.dto.BatchHandleTaskRequest;
import com.mis.taskflow.dto.CreateTaskRequest;
import com.mis.taskflow.dto.HandleTaskRequest;
import com.mis.taskflow.dto.PortalMatterVO;
import com.mis.taskflow.dto.TaskStatsVO;
import com.mis.taskflow.dto.TaskVO;
import com.mis.taskflow.dto.TransferTaskRequest;
import com.mis.taskflow.service.PortalMattersService;
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
    private final PortalMattersService portalMattersService;

    public TaskController(TaskService taskService, PortalMattersService portalMattersService) {
        this.taskService = taskService;
        this.portalMattersService = portalMattersService;
    }

    /** 创建代办（业务服务调用；可按需同时生成关联通知）。 */
    @PostMapping
    public Result<Long> create(@RequestParam Long tenantId,
                               @RequestParam(required = false) Long operatorId,
                               @Valid @RequestBody CreateTaskRequest request) {
        return Result.ok(taskService.createTask(tenantId, operatorId, request));
    }

    /**
     * 我的待办（可含 keyword 模糊过滤；可选发起人/参与人；可选 appCode / scope 归属过滤）。
     *
     * <p>{@code initiatorName}/{@code participantName} 为本轮新增<b>可选</b>尾参：缺省（null/空白）
     * ⇒ 仓储查询对应 clause 恒真 ⇒ 与现状逐字等价（零回归）。
     */
    @GetMapping("/my")
    public Result<PageResult<TaskVO>> my(@RequestParam Long tenantId,
                                         @RequestParam Long assigneeId,
                                         @RequestParam(required = false) String status,
                                         @RequestParam(required = false) String keyword,
                                         @RequestParam(required = false) String initiatorName,
                                         @RequestParam(required = false) String participantName,
                                         @RequestParam(required = false) String appCode,
                                         @RequestParam(required = false) String scope,
                                         @RequestParam(defaultValue = "1") int page,
                                         @RequestParam(defaultValue = "20") int size) {
        return Result.ok(taskService.myTasks(tenantId, assigneeId, status, keyword, appCode, scope,
                initiatorName, participantName, page, size));
    }

    /**
     * 我处理过的（已通过 / 已驳回；可含 keyword 模糊过滤；可选发起人/参与人；可选 appCode / scope 归属过滤）。
     *
     * <p>两新增参数语义同 {@link #my}。
     */
    @GetMapping("/handled")
    public Result<PageResult<TaskVO>> handled(@RequestParam Long tenantId,
                                              @RequestParam Long assigneeId,
                                              @RequestParam(required = false) String keyword,
                                              @RequestParam(required = false) String initiatorName,
                                              @RequestParam(required = false) String participantName,
                                              @RequestParam(required = false) String appCode,
                                              @RequestParam(required = false) String scope,
                                              @RequestParam(defaultValue = "1") int page,
                                              @RequestParam(defaultValue = "20") int size) {
        return Result.ok(taskService.handledTasks(tenantId, assigneeId, keyword, appCode, scope,
                initiatorName, participantName, page, size));
    }

    /**
     * 门户「待办事项 · 全部」（三源 UNION 聚合 + 服务端分页，设计 §2.2 / §3）。
     *
     * <p>{@code userId} = 「我」：既是分支 A（分派给我的 sys_task）的 assignee，
     * 也是分支 B（我发起的 wf_instance）的 initiator。
     */
    @GetMapping("/matters")
    public Result<PageResult<PortalMatterVO>> matters(@RequestParam Long tenantId,
                                                      @RequestParam Long userId,
                                                      @RequestParam(required = false) String keyword,
                                                      @RequestParam(required = false) String initiatorName,
                                                      @RequestParam(required = false) String participantName,
                                                      @RequestParam(required = false) String appCode,
                                                      @RequestParam(required = false) String scope,
                                                      @RequestParam(defaultValue = "1") int page,
                                                      @RequestParam(defaultValue = "20") int size) {
        return Result.ok(portalMattersService.matters(tenantId, userId, keyword, initiatorName,
                participantName, appCode, scope, page, size));
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