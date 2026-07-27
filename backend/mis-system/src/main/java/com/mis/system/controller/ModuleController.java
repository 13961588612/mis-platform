package com.mis.system.controller;

import com.mis.common.core.result.Result;
import com.mis.system.dto.ApiVO;
import com.mis.system.dto.ModuleApiBindingVO;
import com.mis.system.dto.ModuleCreateRequest;
import com.mis.system.dto.ModuleUpdateRequest;
import com.mis.system.dto.ModuleVO;
import com.mis.system.service.ModuleService;
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

@RestController
@RequestMapping("/internal/v1/modules")
public class ModuleController {

    private final ModuleService moduleService;

    public ModuleController(ModuleService moduleService) {
        this.moduleService = moduleService;
    }

    @GetMapping
    public Result<List<ModuleVO>> list() {
        return Result.ok(moduleService.list());
    }

    @GetMapping("/{id}")
    public Result<ModuleVO> get(@PathVariable Long id) {
        return Result.ok(moduleService.get(id));
    }

    @PostMapping
    public Result<ModuleVO> create(@Valid @RequestBody ModuleCreateRequest request) {
        return Result.ok(moduleService.create(request));
    }

    @PutMapping("/{id}")
    public Result<ModuleVO> update(@PathVariable Long id, @Valid @RequestBody ModuleUpdateRequest request) {
        return Result.ok(moduleService.update(id, request));
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        moduleService.delete(id);
        return Result.ok();
    }

    @GetMapping("/{moduleId}/apis")
    public Result<List<ApiVO>> apiTree(@PathVariable Long moduleId) {
        return Result.ok(moduleService.apiTree(moduleId));
    }

    @GetMapping("/{moduleId}/bindings")
    public Result<List<ModuleApiBindingVO>> bindings(@PathVariable Long moduleId) {
        return Result.ok(moduleService.bindings(moduleId));
    }
}
