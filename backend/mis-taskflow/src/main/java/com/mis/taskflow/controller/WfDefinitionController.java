package com.mis.taskflow.controller;

import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import com.mis.taskflow.dto.CreateDefinitionRequest;
import com.mis.taskflow.dto.UpdateSupportedFormsRequest;
import com.mis.taskflow.dto.WfDefinitionDTO;
import com.mis.taskflow.service.WfDefinitionService;
import jakarta.validation.Valid;
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
 * 流程定义内部 API（P5）。
 */
@RestController
@RequestMapping("/internal/v1/workflow/definitions")
public class WfDefinitionController {

    private final WfDefinitionService definitionService;

    public WfDefinitionController(WfDefinitionService definitionService) {
        this.definitionService = definitionService;
    }

    @PostMapping
    public Result<Long> create(@RequestParam Long tenantId,
                               @RequestParam(required = false) Long operatorId,
                               @Valid @RequestBody CreateDefinitionRequest request) {
        return Result.ok(definitionService.create(tenantId, operatorId, request));
    }

    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id,
                               @RequestParam Long tenantId,
                               @Valid @RequestBody CreateDefinitionRequest request) {
        definitionService.update(id, tenantId, request);
        return Result.ok();
    }

    /**
     * 仅更新表单关联（草稿/已发布均可）。一个流程可关联多个表单；一个表单只能关联一个流程。
     */
    @PutMapping("/{id}/supported-forms")
    public Result<Void> updateSupportedForms(@PathVariable Long id,
                                             @RequestParam Long tenantId,
                                             @RequestBody UpdateSupportedFormsRequest request) {
        definitionService.updateSupportedForms(id, tenantId, request);
        return Result.ok();
    }

    @PostMapping("/{id}/activate")
    public Result<Void> activate(@PathVariable Long id, @RequestParam Long tenantId) {
        definitionService.activate(id, tenantId);
        return Result.ok();
    }

    /** 取消发布：ACTIVE → DRAFT。非 ACTIVE 幂等。 */
    @PostMapping("/{id}/deactivate")
    public Result<Void> deactivate(@PathVariable Long id, @RequestParam Long tenantId) {
        definitionService.deactivate(id, tenantId);
        return Result.ok();
    }

    @GetMapping("/{id}")
    public Result<WfDefinitionDTO> get(@PathVariable Long id, @RequestParam Long tenantId) {
        return Result.ok(definitionService.get(id, tenantId));
    }

    @GetMapping("/by-code/{code}")
    public Result<WfDefinitionDTO> getByCode(@PathVariable String code, @RequestParam Long tenantId) {
        return Result.ok(definitionService.getByCode(tenantId, code));
    }

    @GetMapping
    public Result<PageResult<WfDefinitionDTO>> list(@RequestParam Long tenantId,
                                                     @RequestParam(defaultValue = "1") int page,
                                                     @RequestParam(defaultValue = "20") int size,
                                                     @RequestParam(required = false) List<Long> categoryIds,
                                                     @RequestParam(required = false) String keyword) {
        return Result.ok(definitionService.list(tenantId, page, size, categoryIds, keyword));
    }
}
