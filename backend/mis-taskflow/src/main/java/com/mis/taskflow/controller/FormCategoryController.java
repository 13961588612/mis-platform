package com.mis.taskflow.controller;

import com.mis.common.core.result.Result;
import com.mis.taskflow.dto.FormCategoryVO;
import com.mis.taskflow.dto.UpsertFormCategoryRequest;
import com.mis.taskflow.service.FormCategoryService;
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
 * 表单分类内部 API（决策 B：独立 form_category 邻接树）。
 *
 * <p>对外路径由 BFF 暴露为 {@code /api/v1/form-categories}（登记在 V133 的 sys_api 95066-95071）。
 */
@RestController
@RequestMapping("/internal/v1/form-categories")
public class FormCategoryController {

    private final FormCategoryService categoryService;

    public FormCategoryController(FormCategoryService categoryService) {
        this.categoryService = categoryService;
    }

    @GetMapping("/tree")
    public Result<List<FormCategoryVO>> tree(@RequestParam Long tenantId) {
        return Result.ok(categoryService.tree(tenantId));
    }

    @GetMapping
    public Result<List<FormCategoryVO>> list(@RequestParam Long tenantId) {
        return Result.ok(categoryService.list(tenantId));
    }

    @GetMapping("/{id}")
    public Result<FormCategoryVO> get(@PathVariable Long id, @RequestParam Long tenantId) {
        return Result.ok(categoryService.get(id, tenantId));
    }

    @PostMapping
    public Result<Long> create(@RequestParam Long tenantId,
                               @RequestParam(required = false) Long operatorId,
                               @Valid @RequestBody UpsertFormCategoryRequest request) {
        return Result.ok(categoryService.create(tenantId, operatorId, request));
    }

    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id,
                               @RequestParam Long tenantId,
                               @Valid @RequestBody UpsertFormCategoryRequest request) {
        categoryService.update(id, tenantId, request);
        return Result.ok();
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id, @RequestParam Long tenantId) {
        categoryService.delete(id, tenantId);
        return Result.ok();
    }
}
