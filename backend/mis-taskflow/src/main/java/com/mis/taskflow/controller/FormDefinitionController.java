package com.mis.taskflow.controller;

import com.mis.common.core.result.Result;
import com.mis.taskflow.dto.FormDefinitionVO;
import com.mis.taskflow.dto.UpsertFormDefinitionRequest;
import com.mis.taskflow.service.FormDefinitionService;
import jakarta.validation.Valid;
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

/**
 * 业务表单注册内部 API。
 *
 * <p>对外路径由 BFF 暴露为 {@code /api/v1/form-definitions}（登记在 V128 的 sys_api 95051-95055）。
 *
 * <p>V133：表单不再有树，故 {@code GET /tree} 端点已移除（对应 sys_api 95051 行保留但休眠）；
 * 列表新增 {@code categoryIds} 多值精确过滤（逗号串由前端/BFF 传入，Spring 自动拆分为 List）。
 */
@RestController
@RequestMapping("/internal/v1/form-definitions")
public class FormDefinitionController {

    private final FormDefinitionService formService;

    public FormDefinitionController(FormDefinitionService formService) {
        this.formService = formService;
    }

    @GetMapping
    public Result<List<FormDefinitionVO>> list(@RequestParam Long tenantId,
                                               @RequestParam(required = false) String status,
                                               @RequestParam(required = false) List<Long> categoryIds) {
        return Result.ok(formService.list(tenantId, status, categoryIds));
    }

    @GetMapping("/{id}")
    public Result<FormDefinitionVO> get(@PathVariable Long id, @RequestParam Long tenantId) {
        return Result.ok(formService.get(id, tenantId));
    }

    @PostMapping
    public Result<Long> create(@RequestParam Long tenantId,
                               @RequestParam(required = false) Long operatorId,
                               @Valid @RequestBody UpsertFormDefinitionRequest request) {
        return Result.ok(formService.create(tenantId, operatorId, request));
    }

    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id,
                               @RequestParam Long tenantId,
                               @Valid @RequestBody UpsertFormDefinitionRequest request) {
        formService.update(id, tenantId, request);
        return Result.ok();
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id, @RequestParam Long tenantId) {
        formService.delete(id, tenantId);
        return Result.ok();
    }
}
