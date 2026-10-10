package com.mis.taskflow.controller;

import com.mis.common.core.result.Result;
import com.mis.taskflow.dto.UpsertWfCategoryRequest;
import com.mis.taskflow.dto.WfCategoryVO;
import com.mis.taskflow.service.WfCategoryService;
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
 * 流程分类内部 API（决策 B：独立 wf_category 邻接树）。
 *
 * <p>对外路径由 BFF 暴露为 {@code /api/v1/workflow/categories}（登记在 V132 的 sys_api 95060-95065）。
 */
@RestController
@RequestMapping("/internal/v1/workflow/categories")
public class WfCategoryController {

    private final WfCategoryService categoryService;

    public WfCategoryController(WfCategoryService categoryService) {
        this.categoryService = categoryService;
    }

    @GetMapping("/tree")
    public Result<List<WfCategoryVO>> tree(@RequestParam Long tenantId) {
        return Result.ok(categoryService.tree(tenantId));
    }

    @GetMapping
    public Result<List<WfCategoryVO>> list(@RequestParam Long tenantId) {
        return Result.ok(categoryService.list(tenantId));
    }

    @GetMapping("/{id}")
    public Result<WfCategoryVO> get(@PathVariable Long id, @RequestParam Long tenantId) {
        return Result.ok(categoryService.get(id, tenantId));
    }

    @PostMapping
    public Result<Long> create(@RequestParam Long tenantId,
                               @RequestParam(required = false) Long operatorId,
                               @Valid @RequestBody UpsertWfCategoryRequest request) {
        return Result.ok(categoryService.create(tenantId, operatorId, request));
    }

    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id,
                               @RequestParam Long tenantId,
                               @Valid @RequestBody UpsertWfCategoryRequest request) {
        categoryService.update(id, tenantId, request);
        return Result.ok();
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id, @RequestParam Long tenantId) {
        categoryService.delete(id, tenantId);
        return Result.ok();
    }
}
