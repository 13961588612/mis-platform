package com.mis.taskflow.controller;

import com.mis.common.core.result.Result;
import com.mis.taskflow.dto.BizCategoryVO;
import com.mis.taskflow.dto.UpsertBizCategoryRequest;
import com.mis.taskflow.service.BizCategoryService;
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
 * 业务分类内部 API（租户通用邻接树 {@code biz_category}）。
 *
 * <p>对外路径由 BFF 暴露为 {@code /api/v1/biz-categories}（登记在 V139 的 sys_api 95093-95098）。
 */
@RestController
@RequestMapping("/internal/v1/biz-categories")
public class BizCategoryController {

    private final BizCategoryService categoryService;

    public BizCategoryController(BizCategoryService categoryService) {
        this.categoryService = categoryService;
    }

    @GetMapping("/tree")
    public Result<List<BizCategoryVO>> tree(@RequestParam Long tenantId) {
        return Result.ok(categoryService.tree(tenantId));
    }

    @GetMapping
    public Result<List<BizCategoryVO>> list(@RequestParam Long tenantId) {
        return Result.ok(categoryService.list(tenantId));
    }

    @GetMapping("/{id}")
    public Result<BizCategoryVO> get(@PathVariable Long id, @RequestParam Long tenantId) {
        return Result.ok(categoryService.get(id, tenantId));
    }

    @PostMapping
    public Result<Long> create(@RequestParam Long tenantId,
                               @RequestParam(required = false) Long operatorId,
                               @Valid @RequestBody UpsertBizCategoryRequest request) {
        return Result.ok(categoryService.create(tenantId, operatorId, request));
    }

    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id,
                               @RequestParam Long tenantId,
                               @Valid @RequestBody UpsertBizCategoryRequest request) {
        categoryService.update(id, tenantId, request);
        return Result.ok();
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id, @RequestParam Long tenantId) {
        categoryService.delete(id, tenantId);
        return Result.ok();
    }
}
