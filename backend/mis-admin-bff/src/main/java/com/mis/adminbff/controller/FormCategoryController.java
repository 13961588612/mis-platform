package com.mis.adminbff.controller;

import com.mis.adminbff.client.TaskflowWebClient;
import com.mis.adminbff.client.model.FormCategoryVO;
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
 * 表单分类对外 API（BFF 透传 mis-taskflow，决策 B：独立 form_category 邻接树）。
 *
 * <p>路径与 {@code sys_api} 登记（V133 的 95066-95071）逐字一致——{@code deny-unmapped:true} 下
 * 路径写错会落成 403。权限由 95011（permission=biz:form:list）覆盖，本端不落业务逻辑。
 */
@RestController
@RequestMapping("/api/v1/form-categories")
public class FormCategoryController {

    private final TaskflowWebClient taskflowWebClient;

    public FormCategoryController(TaskflowWebClient taskflowWebClient) {
        this.taskflowWebClient = taskflowWebClient;
    }

    @GetMapping("/tree")
    public Result<List<FormCategoryVO>> tree(@RequestParam(required = false) Long tenantId) {
        return Result.ok(taskflowWebClient.formCategoryTree(TaskflowIdentity.tenantId(tenantId)));
    }

    @GetMapping
    public Result<List<FormCategoryVO>> list(@RequestParam(required = false) Long tenantId) {
        return Result.ok(taskflowWebClient.formCategories(TaskflowIdentity.tenantId(tenantId)));
    }

    @GetMapping("/{id}")
    public Result<FormCategoryVO> get(@PathVariable Long id, @RequestParam(required = false) Long tenantId) {
        return Result.ok(taskflowWebClient.getFormCategory(id, TaskflowIdentity.tenantId(tenantId)));
    }

    @PostMapping
    public Result<Long> create(@RequestParam(required = false) Long tenantId,
                               @RequestParam(required = false) Long operatorId,
                               @RequestBody Map<String, Object> body) {
        return Result.ok(taskflowWebClient.createFormCategory(
                TaskflowIdentity.tenantId(tenantId), TaskflowIdentity.operatorId(operatorId), body));
    }

    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id,
                               @RequestParam(required = false) Long tenantId,
                               @RequestBody Map<String, Object> body) {
        taskflowWebClient.updateFormCategory(id, TaskflowIdentity.tenantId(tenantId), body);
        return Result.ok();
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id, @RequestParam(required = false) Long tenantId) {
        taskflowWebClient.deleteFormCategory(id, TaskflowIdentity.tenantId(tenantId));
        return Result.ok();
    }
}
