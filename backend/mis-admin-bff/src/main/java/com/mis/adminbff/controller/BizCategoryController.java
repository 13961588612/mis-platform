package com.mis.adminbff.controller;

import com.mis.adminbff.client.TaskflowWebClient;
import com.mis.adminbff.client.model.BizCategoryVO;
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
 * 业务分类对外 API（BFF 透传 mis-taskflow，租户通用邻接树）。
 *
 * <p>路径与 {@code sys_api} 登记（V139 的 95093-95098）逐字一致——{@code deny-unmapped:true} 下
 * 路径写错会落成 403。权限由菜单 95012（permission=biz:category:list）覆盖，本端不落业务逻辑。
 */
@RestController
@RequestMapping("/api/v1/biz-categories")
public class BizCategoryController {

    private final TaskflowWebClient taskflowWebClient;

    public BizCategoryController(TaskflowWebClient taskflowWebClient) {
        this.taskflowWebClient = taskflowWebClient;
    }

    @GetMapping("/tree")
    public Result<List<BizCategoryVO>> tree(@RequestParam(required = false) Long tenantId) {
        return Result.ok(taskflowWebClient.bizCategoryTree(TaskflowIdentity.tenantId(tenantId)));
    }

    @GetMapping
    public Result<List<BizCategoryVO>> list(@RequestParam(required = false) Long tenantId) {
        return Result.ok(taskflowWebClient.bizCategories(TaskflowIdentity.tenantId(tenantId)));
    }

    @GetMapping("/{id}")
    public Result<BizCategoryVO> get(@PathVariable Long id, @RequestParam(required = false) Long tenantId) {
        return Result.ok(taskflowWebClient.getBizCategory(id, TaskflowIdentity.tenantId(tenantId)));
    }

    @PostMapping
    public Result<Long> create(@RequestParam(required = false) Long tenantId,
                               @RequestParam(required = false) Long operatorId,
                               @RequestBody Map<String, Object> body) {
        return Result.ok(taskflowWebClient.createBizCategory(
                TaskflowIdentity.tenantId(tenantId), TaskflowIdentity.operatorId(operatorId), body));
    }

    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id,
                               @RequestParam(required = false) Long tenantId,
                               @RequestBody Map<String, Object> body) {
        taskflowWebClient.updateBizCategory(id, TaskflowIdentity.tenantId(tenantId), body);
        return Result.ok();
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id, @RequestParam(required = false) Long tenantId) {
        taskflowWebClient.deleteBizCategory(id, TaskflowIdentity.tenantId(tenantId));
        return Result.ok();
    }
}
