package com.mis.adminbff.controller;

import com.mis.adminbff.client.TaskflowWebClient;
import com.mis.adminbff.support.TaskflowIdentity;
import com.mis.adminbff.client.model.ProcessDetailVO;
import com.mis.adminbff.client.model.WfDefinitionDTO;
import com.mis.adminbff.client.model.WfInstanceVO;
import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 工作流对外 API（BFF 透传 mis-taskflow）。
 */
@RestController
@RequestMapping("/api/v1/workflow")
public class WorkflowController {

    private final TaskflowWebClient taskflowWebClient;

    public WorkflowController(TaskflowWebClient taskflowWebClient) {
        this.taskflowWebClient = taskflowWebClient;
    }

    @PostMapping("/definitions")
    public Result<Long> createDefinition(@RequestParam(required = false) Long tenantId,
                                         @RequestParam(required = false) Long operatorId,
                                         @RequestBody Map<String, Object> body) {
        return Result.ok(taskflowWebClient.createWorkflowDefinition(TaskflowIdentity.tenantId(tenantId), TaskflowIdentity.operatorId(operatorId), body));
    }

    @GetMapping("/definitions/{id}")
    public Result<WfDefinitionDTO> definition(@PathVariable Long id, @RequestParam(required = false) Long tenantId) {
        return Result.ok(taskflowWebClient.workflowDefinition(id, TaskflowIdentity.tenantId(tenantId)));
    }

    @GetMapping("/definitions")
    public Result<PageResult<WfDefinitionDTO>> definitions(@RequestParam(required = false) Long tenantId,
                                                           @RequestParam(defaultValue = "1") int page,
                                                           @RequestParam(defaultValue = "20") int size) {
        return Result.ok(taskflowWebClient.workflowDefinitions(TaskflowIdentity.tenantId(tenantId), page, size));
    }

    @PostMapping("/definitions/{id}/activate")
    public Result<Void> activate(@PathVariable Long id, @RequestParam(required = false) Long tenantId) {
        taskflowWebClient.activateWorkflowDefinition(id, TaskflowIdentity.tenantId(tenantId));
        return Result.ok();
    }

    /**
     * 更新流程定义（草稿）。
     *
     * <p>⚠️ 本端点在 V128 之前就已存在于 mis-taskflow，但 sys_api 从未登记（V123 只登记了
     * GET/POST/activate），{@code deny-unmapped:true} 会把它拦成 403 ⇒「编辑已有定义」这条路
     * 一直是死的。V128 的 95056 补上登记。
     */
    @PutMapping("/definitions/{id}")
    public Result<Void> updateDefinition(@PathVariable Long id,
                                         @RequestParam(required = false) Long tenantId,
                                         @RequestBody Map<String, Object> body) {
        taskflowWebClient.updateWorkflowDefinition(id, TaskflowIdentity.tenantId(tenantId), body);
        return Result.ok();
    }

    /** 取消发布：ACTIVE → DRAFT。非ACTIVE 幂等。 */
    @PostMapping("/definitions/{id}/deactivate")
    public Result<Void> deactivate(@PathVariable Long id, @RequestParam(required = false) Long tenantId) {
        taskflowWebClient.deactivateWorkflowDefinition(id, TaskflowIdentity.tenantId(tenantId));
        return Result.ok();
    }

    @PostMapping("/instances/start")
    public Result<Long> start(@RequestParam(required = false) Long tenantId, @RequestBody Map<String, Object> body) {
        return Result.ok(taskflowWebClient.startProcess(TaskflowIdentity.tenantId(tenantId), body));
    }

    @GetMapping("/instances/{id}")
    public Result<ProcessDetailVO> detail(@PathVariable Long id, @RequestParam(required = false) Long tenantId) {
        return Result.ok(taskflowWebClient.processDetail(id, TaskflowIdentity.tenantId(tenantId)));
    }

    @GetMapping("/instances/my")
    public Result<PageResult<WfInstanceVO>> myProcesses(@RequestParam(required = false) Long tenantId,
                                                        @RequestParam(required = false) Long initiatorId,
                                                        @RequestParam(required = false) String status,
                                                        @RequestParam(defaultValue = "1") int page,
                                                        @RequestParam(defaultValue = "20") int size) {
        return Result.ok(taskflowWebClient.myProcesses(TaskflowIdentity.tenantId(tenantId), TaskflowIdentity.userId(initiatorId), status, page, size));
    }

    @PostMapping("/tasks/{id}/complete")
    public Result<Void> completeTask(@PathVariable Long id,
                                     @RequestParam(required = false) Long tenantId,
                                     @RequestParam(required = false) Long operatorId,
                                     @RequestBody Map<String, Object> body) {
        taskflowWebClient.completeWfTask(id, TaskflowIdentity.tenantId(tenantId), TaskflowIdentity.operatorId(operatorId), body);
        return Result.ok();
    }
}