package com.mis.system.controller;

import com.mis.common.core.result.Result;
import com.mis.system.dto.ApiCreateRequest;
import com.mis.system.dto.ApiPermissionRuleVO;
import com.mis.system.dto.ApiUpdateRequest;
import com.mis.system.dto.ApiVO;
import com.mis.system.service.ApiService;
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

@RestController
@RequestMapping("/internal/v1")
public class ApiController {

    private final ApiService apiService;

    public ApiController(ApiService apiService) {
        this.apiService = apiService;
    }

    @GetMapping("/apis/tree")
    public Result<List<ApiVO>> tree(@RequestParam Long moduleId) {
        return Result.ok(apiService.tree(moduleId));
    }

    @GetMapping("/api-permissions/registry")
    public Result<List<ApiPermissionRuleVO>> registry() {
        return Result.ok(apiService.registry());
    }

    @PostMapping("/apis")
    public Result<ApiVO> create(@Valid @RequestBody ApiCreateRequest request) {
        return Result.ok(apiService.create(request));
    }

    @PutMapping("/apis/{id}")
    public Result<ApiVO> update(@PathVariable Long id, @Valid @RequestBody ApiUpdateRequest request) {
        return Result.ok(apiService.update(id, request));
    }

    @DeleteMapping("/apis/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        apiService.delete(id);
        return Result.ok();
    }
}
