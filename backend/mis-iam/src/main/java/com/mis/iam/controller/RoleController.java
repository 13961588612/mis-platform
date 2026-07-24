package com.mis.iam.controller;

import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import com.mis.common.jpa.support.PageMapper;
import com.mis.iam.dto.RoleCreateRequest;
import com.mis.iam.dto.RoleDataScopeRequest;
import com.mis.iam.dto.RoleDataScopeVO;
import com.mis.iam.dto.RoleMenuAssignRequest;
import com.mis.iam.dto.RoleUpdateRequest;
import com.mis.iam.dto.RoleVO;
import com.mis.iam.service.RolePermissionService;
import com.mis.iam.service.RoleService;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
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
@RequestMapping("/internal/v1/roles")
public class RoleController {

    private final RoleService roleService;
    private final RolePermissionService rolePermissionService;

    public RoleController(RoleService roleService, RolePermissionService rolePermissionService) {
        this.roleService = roleService;
        this.rolePermissionService = rolePermissionService;
    }

    @GetMapping
    public Result<PageResult<RoleVO>> page(
            @RequestParam Long tenantId,
            @RequestParam Long appId,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        Page<RoleVO> result = roleService.page(tenantId, appId, page, size);
        return Result.ok(PageMapper.toPageResult(result));
    }

    @GetMapping("/enabled")
    public Result<List<RoleVO>> listEnabled(@RequestParam Long tenantId, @RequestParam Long appId) {
        return Result.ok(roleService.listEnabled(tenantId, appId));
    }

    @GetMapping("/{id}")
    public Result<RoleVO> get(@PathVariable Long id) {
        return Result.ok(roleService.getById(id));
    }

    @PostMapping
    public Result<RoleVO> create(@Valid @RequestBody RoleCreateRequest request) {
        return Result.ok(roleService.create(request));
    }

    @PutMapping("/{id}")
    public Result<RoleVO> update(@PathVariable Long id, @Valid @RequestBody RoleUpdateRequest request) {
        return Result.ok(roleService.update(id, request));
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        roleService.delete(id);
        return Result.ok();
    }

    @GetMapping("/{id}/menus")
    public Result<List<Long>> listMenus(@PathVariable Long id) {
        return Result.ok(rolePermissionService.listMenuIds(id));
    }

    @PutMapping("/{id}/menus")
    public Result<Void> assignMenus(@PathVariable Long id, @Valid @RequestBody RoleMenuAssignRequest request) {
        rolePermissionService.assignMenus(id, request);
        return Result.ok();
    }

    @GetMapping("/{id}/data-scope")
    public Result<RoleDataScopeVO> getDataScope(@PathVariable Long id) {
        return Result.ok(rolePermissionService.getDataScope(id));
    }

    @PutMapping("/{id}/data-scope")
    public Result<RoleDataScopeVO> assignDataScope(
            @PathVariable Long id, @Valid @RequestBody RoleDataScopeRequest request) {
        return Result.ok(rolePermissionService.assignDataScope(id, request));
    }
}
