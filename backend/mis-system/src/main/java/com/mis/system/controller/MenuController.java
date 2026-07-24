package com.mis.system.controller;

import com.mis.common.core.result.Result;
import com.mis.system.dto.MenuCreateRequest;
import com.mis.system.dto.MenuUpdateRequest;
import com.mis.system.dto.MenuVO;
import com.mis.system.service.MenuService;
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
@RequestMapping("/internal/v1/menus")
public class MenuController {

    private final MenuService menuService;

    public MenuController(MenuService menuService) {
        this.menuService = menuService;
    }

    @GetMapping("/tree")
    public Result<List<MenuVO>> tree(@RequestParam Long appId) {
        return Result.ok(menuService.tree(appId));
    }

    @GetMapping("/router")
    public Result<List<MenuVO>> router(
            @RequestParam Long appId,
            @RequestParam(required = false) String menuIds) {
        return Result.ok(menuService.router(appId, MenuService.parseIds(menuIds)));
    }

    @GetMapping("/permissions")
    public Result<List<String>> permissions(@RequestParam String menuIds) {
        return Result.ok(menuService.permissionCodes(MenuService.parseIds(menuIds)));
    }

    @GetMapping("/{id}")
    public Result<MenuVO> get(@PathVariable Long id) {
        return Result.ok(menuService.getById(id));
    }

    @PostMapping
    public Result<MenuVO> create(@Valid @RequestBody MenuCreateRequest request) {
        return Result.ok(menuService.create(request));
    }

    @PutMapping("/{id}")
    public Result<MenuVO> update(@PathVariable Long id, @Valid @RequestBody MenuUpdateRequest request) {
        return Result.ok(menuService.update(id, request));
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        menuService.delete(id);
        return Result.ok();
    }
}
