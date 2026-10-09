package com.mis.adminbff.controller;

import com.mis.adminbff.client.TaskflowWebClient;
import com.mis.adminbff.client.model.FormDefinitionVO;
import com.mis.adminbff.support.TaskflowIdentity;
import com.mis.common.core.result.Result;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 业务表单注册对外 API（BFF 透传 mis-taskflow）。
 *
 * <p>路径与 {@code sys_api} 登记（V128 的 95051-95055）逐字一致——{@code deny-unmapped:true} 下
 * 路径写错会落成 403。
 */
@RestController
@RequestMapping("/api/v1/form-definitions")
public class FormDefinitionController {

    private final TaskflowWebClient taskflowWebClient;

    public FormDefinitionController(TaskflowWebClient taskflowWebClient) {
        this.taskflowWebClient = taskflowWebClient;
    }

    @GetMapping("/tree")
    public Result<List<FormDefinitionVO>> tree(@RequestParam(required = false) Long tenantId) {
        return Result.ok(taskflowWebClient.formDefinitionTree(TaskflowIdentity.tenantId(tenantId)));
    }

    @GetMapping
    public Result<List<FormDefinitionVO>> list(@RequestParam(required = false) Long tenantId,
                                               @RequestParam(required = false) String status) {
        return Result.ok(taskflowWebClient.formDefinitions(TaskflowIdentity.tenantId(tenantId), status));
    }

    @GetMapping("/{id}")
    public Result<FormDefinitionVO> get(@PathVariable Long id,
                                       @RequestParam(required = false) Long tenantId) {
        return Result.ok(taskflowWebClient.formDefinition(id, TaskflowIdentity.tenantId(tenantId)));
    }

    @PostMapping
    public Result<Long> create(@RequestParam(required = false) Long tenantId,
                               @RequestParam(required = false) Long operatorId,
                               @RequestBody Map<String, Object> body) {
        return Result.ok(taskflowWebClient.createFormDefinition(
                TaskflowIdentity.tenantId(tenantId), TaskflowIdentity.operatorId(operatorId), body));
    }

    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id,
                               @RequestParam(required = false) Long tenantId,
                               @RequestBody Map<String, Object> body) {
        taskflowWebClient.updateFormDefinition(id, TaskflowIdentity.tenantId(tenantId), body);
        return Result.ok();
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id,
                               @RequestParam(required = false) Long tenantId) {
        taskflowWebClient.deleteFormDefinition(id, TaskflowIdentity.tenantId(tenantId));
        return Result.ok();
    }
}