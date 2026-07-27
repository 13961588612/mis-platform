package com.mis.adminbff.controller;

import com.mis.adminbff.dto.ApiVO;
import com.mis.adminbff.dto.ModuleApiBindingVO;
import com.mis.adminbff.dto.ModuleApiCreateRequest;
import com.mis.adminbff.dto.ModuleApiUpdateRequest;
import com.mis.adminbff.dto.ModuleCreateRequest;
import com.mis.adminbff.dto.ModuleUpdateRequest;
import com.mis.adminbff.dto.ModuleVO;
import com.mis.adminbff.service.ModuleFacadeService;
import com.mis.common.core.result.Result;
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
@RequestMapping("/api/v1/modules")
public class ModuleController {

    private final ModuleFacadeService moduleFacadeService;

    public ModuleController(ModuleFacadeService moduleFacadeService) {
        this.moduleFacadeService = moduleFacadeService;
    }

    @GetMapping
    public Result<List<ModuleVO>> list() {
        return Result.ok(moduleFacadeService.list());
    }

    @GetMapping("/{id}")
    public Result<ModuleVO> get(@PathVariable Long id) {
        return Result.ok(moduleFacadeService.get(id));
    }

    @PostMapping
    public Result<ModuleVO> create(@Valid @RequestBody ModuleCreateRequest request) {
        return Result.ok(moduleFacadeService.create(request));
    }

    @PutMapping("/{id}")
    public Result<ModuleVO> update(@PathVariable Long id, @Valid @RequestBody ModuleUpdateRequest request) {
        return Result.ok(moduleFacadeService.update(id, request));
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        moduleFacadeService.delete(id);
        return Result.ok();
    }

    @GetMapping("/{moduleId}/apis")
    public Result<List<ApiVO>> apiTree(@PathVariable Long moduleId) {
        return Result.ok(moduleFacadeService.apiTree(moduleId));
    }

    @GetMapping("/{moduleId}/bindings")
    public Result<List<ModuleApiBindingVO>> bindings(@PathVariable Long moduleId) {
        return Result.ok(moduleFacadeService.bindings(moduleId));
    }

    @PostMapping("/{moduleId}/apis")
    public Result<ApiVO> createApi(
            @PathVariable Long moduleId,
            @Valid @RequestBody ModuleApiCreateRequest request) {
        ModuleApiCreateRequest effective = new ModuleApiCreateRequest(
                moduleId,
                request.parentId(),
                request.code(),
                request.type(),
                request.name(),
                request.httpMethod(),
                request.pathPattern(),
                request.sort(),
                request.status());
        return Result.ok(moduleFacadeService.createApi(effective));
    }

    @PutMapping("/apis/{apiId}")
    public Result<ApiVO> updateApi(@PathVariable Long apiId, @Valid @RequestBody ModuleApiUpdateRequest request) {
        return Result.ok(moduleFacadeService.updateApi(apiId, request));
    }

    @DeleteMapping("/apis/{apiId}")
    public Result<Void> deleteApi(@PathVariable Long apiId) {
        moduleFacadeService.deleteApi(apiId);
        return Result.ok();
    }
}
