package com.mis.adminbff.controller;

import com.mis.adminbff.client.model.IamRoleVO;
import com.mis.adminbff.client.model.RoleDataScopeVO;
import com.mis.adminbff.dto.RoleCreateRequest;
import com.mis.adminbff.dto.RoleDataScopeRequest;
import com.mis.adminbff.dto.RoleMenuAssignRequest;
import com.mis.adminbff.dto.RoleUpdateRequest;
import com.mis.adminbff.service.RoleFacadeService;
import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
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
@RequestMapping("/api/v1/roles")
public class RoleController {

    private final RoleFacadeService roleFacadeService;

    public RoleController(RoleFacadeService roleFacadeService) {
        this.roleFacadeService = roleFacadeService;
    }

    @GetMapping
    public Result<PageResult<IamRoleVO>> page(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        return Result.ok(roleFacadeService.page(page, size));
    }

    @GetMapping("/enabled")
    public Result<List<IamRoleVO>> listEnabled() {
        return Result.ok(roleFacadeService.listEnabled());
    }

    @GetMapping("/{id}")
    public Result<IamRoleVO> get(@PathVariable Long id) {
        return Result.ok(roleFacadeService.get(id));
    }

    @PostMapping
    public Result<IamRoleVO> create(@Valid @RequestBody RoleCreateRequest request) {
        return Result.ok(roleFacadeService.create(request));
    }

    @PutMapping("/{id}")
    public Result<IamRoleVO> update(@PathVariable Long id, @Valid @RequestBody RoleUpdateRequest request) {
        return Result.ok(roleFacadeService.update(id, request));
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        roleFacadeService.delete(id);
        return Result.ok();
    }

    @GetMapping("/{id}/menus")
    public Result<List<Long>> listMenus(@PathVariable Long id) {
        return Result.ok(roleFacadeService.listMenus(id));
    }

    @PutMapping("/{id}/menus")
    public Result<Void> assignMenus(@PathVariable Long id, @Valid @RequestBody RoleMenuAssignRequest request) {
        roleFacadeService.assignMenus(id, request);
        return Result.ok();
    }

    @GetMapping("/{id}/data-scope")
    public Result<RoleDataScopeVO> getDataScope(@PathVariable Long id) {
        return Result.ok(roleFacadeService.getDataScope(id));
    }

    @PutMapping("/{id}/data-scope")
    public Result<RoleDataScopeVO> assignDataScope(
            @PathVariable Long id, @Valid @RequestBody RoleDataScopeRequest request) {
        return Result.ok(roleFacadeService.assignDataScope(id, request));
    }
}
