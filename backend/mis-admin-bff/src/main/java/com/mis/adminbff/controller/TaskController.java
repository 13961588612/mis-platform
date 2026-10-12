package com.mis.adminbff.controller;

import com.mis.adminbff.client.TaskflowWebClient;
import com.mis.adminbff.support.TaskflowIdentity;
import com.mis.adminbff.client.model.PortalMatterVO;
import com.mis.adminbff.client.model.TaskStatsVO;
import com.mis.adminbff.client.model.TaskVO;
import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 代办任务对外 API（BFF 透传 mis-taskflow）。
 */
@RestController
@RequestMapping("/api/v1/tasks")
public class TaskController {

    private final TaskflowWebClient taskflowWebClient;

    public TaskController(TaskflowWebClient taskflowWebClient) {
        this.taskflowWebClient = taskflowWebClient;
    }

    @GetMapping("/my")
    public Result<PageResult<TaskVO>> my(@RequestParam(required = false) Long tenantId,
                                         @RequestParam(required = false) Long assigneeId,
                                         @RequestParam(required = false) String status,
                                         @RequestParam(required = false) String keyword,
                                         @RequestParam(required = false) String initiatorName,
                                         @RequestParam(required = false) String participantName,
                                         @RequestParam(required = false) String appCode,
                                         @RequestParam(required = false) String scope,
                                         @RequestParam(defaultValue = "1") int page,
                                         @RequestParam(defaultValue = "20") int size) {
        return Result.ok(taskflowWebClient.myTasks(TaskflowIdentity.tenantId(tenantId), TaskflowIdentity.userId(assigneeId),
                status, keyword, appCode, scope, initiatorName, participantName, page, size));
    }

    @GetMapping("/handled")
    public Result<PageResult<TaskVO>> handled(@RequestParam(required = false) Long tenantId,
                                              @RequestParam(required = false) Long assigneeId,
                                              @RequestParam(required = false) String keyword,
                                              @RequestParam(required = false) String initiatorName,
                                              @RequestParam(required = false) String participantName,
                                              @RequestParam(required = false) String appCode,
                                              @RequestParam(required = false) String scope,
                                              @RequestParam(defaultValue = "1") int page,
                                              @RequestParam(defaultValue = "20") int size) {
        return Result.ok(taskflowWebClient.handledTasks(
                TaskflowIdentity.tenantId(tenantId), TaskflowIdentity.userId(assigneeId),
                keyword, appCode, scope, initiatorName, participantName, page, size));
    }

    /**
     * 门户「待办事项 · 全部」聚合（三源 UNION + 服务端分页）。
     *
     * <p>外网路径 {@code /api/v1/tasks/matters} 必须与 {@code sys_api.path_pattern} 严格一致
     * （{@code V141__portal_matters_api.sql} 登记），否则 {@code deny-unmapped:true} 拦成 403。
     * {@code userId} 缺省取当前登录用户。
     */
    @GetMapping("/matters")
    public Result<PageResult<PortalMatterVO>> matters(@RequestParam(required = false) Long tenantId,
                                                      @RequestParam(required = false) Long userId,
                                                      @RequestParam(required = false) String keyword,
                                                      @RequestParam(required = false) String initiatorName,
                                                      @RequestParam(required = false) String participantName,
                                                      @RequestParam(required = false) String appCode,
                                                      @RequestParam(required = false) String scope,
                                                      @RequestParam(defaultValue = "1") int page,
                                                      @RequestParam(defaultValue = "20") int size) {
        return Result.ok(taskflowWebClient.matters(TaskflowIdentity.tenantId(tenantId), TaskflowIdentity.userId(userId),
                keyword, initiatorName, participantName, appCode, scope, page, size));
    }

    @GetMapping("/stats")
    public Result<TaskStatsVO> stats(@RequestParam(required = false) Long tenantId, @RequestParam(required = false) Long assigneeId) {
        return Result.ok(taskflowWebClient.taskStats(TaskflowIdentity.tenantId(tenantId), TaskflowIdentity.userId(assigneeId)));
    }

    @PostMapping("/{id}/handle")
    public Result<Void> handle(@PathVariable Long id,
                               @RequestParam(required = false) Long tenantId,
                               @RequestParam(required = false) Long operatorId,
                               @RequestBody Map<String, Object> body) {
        taskflowWebClient.handleTask(id, TaskflowIdentity.tenantId(tenantId), TaskflowIdentity.operatorId(operatorId), body);
        return Result.ok();
    }

    @PostMapping("/{id}/transfer")
    public Result<Void> transfer(@PathVariable Long id,
                                 @RequestParam(required = false) Long tenantId,
                                 @RequestParam(required = false) Long operatorId,
                                 @RequestBody Map<String, Object> body) {
        taskflowWebClient.transferTask(id, TaskflowIdentity.tenantId(tenantId), TaskflowIdentity.operatorId(operatorId), body);
        return Result.ok();
    }

    @PostMapping("/batch-handle")
    public Result<Integer> batchHandle(@RequestParam(required = false) Long tenantId,
                                       @RequestParam(required = false) Long operatorId,
                                       @RequestBody Map<String, Object> body) {
        return Result.ok(taskflowWebClient.batchHandleTasks(TaskflowIdentity.tenantId(tenantId), TaskflowIdentity.operatorId(operatorId), body));
    }
}