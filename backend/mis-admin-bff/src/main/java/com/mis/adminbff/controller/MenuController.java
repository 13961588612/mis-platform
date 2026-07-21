package com.mis.adminbff.controller;

import com.mis.adminbff.client.model.MenuVO;
import com.mis.adminbff.dto.MenuCreateRequest;
import com.mis.adminbff.dto.MenuUpdateRequest;
import com.mis.adminbff.dto.RouterNode;
import com.mis.adminbff.service.MenuAggregateService;
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
@RequestMapping("/api/v1/menus")
public class MenuController {

    private final MenuAggregateService menuAggregateService;

    public MenuController(MenuAggregateService menuAggregateService) {
        this.menuAggregateService = menuAggregateService;
    }

    @GetMapping("/router")
    public Result<List<RouterNode>> router() {
        return Result.ok(menuAggregateService.router());
    }

    @GetMapping("/permissions")
    public Result<List<String>> permissions() {
        return Result.ok(menuAggregateService.currentPermissions());
    }

    @GetMapping("/tree")
    public Result<List<MenuVO>> tree() {
        return Result.ok(menuAggregateService.tree());
    }

    @GetMapping("/{id}")
    public Result<MenuVO> get(@PathVariable Long id) {
        return Result.ok(menuAggregateService.get(id));
    }

    @PostMapping
    public Result<MenuVO> create(@Valid @RequestBody MenuCreateRequest request) {
        return Result.ok(menuAggregateService.create(request));
    }

    @PutMapping("/{id}")
    public Result<MenuVO> update(@PathVariable Long id, @Valid @RequestBody MenuUpdateRequest request) {
        return Result.ok(menuAggregateService.update(id, request));
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        menuAggregateService.delete(id);
        return Result.ok();
    }
}
