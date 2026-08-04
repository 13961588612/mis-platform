package com.mis.kb.api.controller;

import com.mis.common.core.result.Result;
import com.mis.kb.api.dto.KbCategoryCreateRequest;
import com.mis.kb.api.dto.KbCategoryUpdateRequest;
import com.mis.kb.api.dto.KbCategoryVO;
import com.mis.kb.domain.service.KbCategoryService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 分类管理（内部端点，供 BFF 聚合）。 */
@RestController
@RequestMapping("/internal/v1/kb/categories")
public class CategoryController {

    private final KbCategoryService categoryService;

    public CategoryController(KbCategoryService categoryService) {
        this.categoryService = categoryService;
    }

    @GetMapping
    public Result<List<KbCategoryVO>> list() {
        return Result.ok(categoryService.listAll());
    }

    @PostMapping
    public Result<KbCategoryVO> create(@Valid @RequestBody KbCategoryCreateRequest request) {
        return Result.ok(categoryService.create(request));
    }

    @PutMapping("/{id}")
    public Result<KbCategoryVO> update(@PathVariable Long id, @Valid @RequestBody KbCategoryUpdateRequest request) {
        return Result.ok(categoryService.update(id, request));
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        categoryService.delete(id);
        return Result.ok();
    }
}
