package com.mis.org.controller;

import com.mis.common.core.result.Result;
import com.mis.org.dto.DeptCreateRequest;
import com.mis.org.dto.DeptUpdateRequest;
import com.mis.org.dto.DeptVO;
import com.mis.org.service.DeptService;
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
@RequestMapping("/internal/v1/depts")
public class DeptController {

    private final DeptService deptService;

    public DeptController(DeptService deptService) {
        this.deptService = deptService;
    }

    @GetMapping("/tree")
    public Result<List<DeptVO>> tree(@RequestParam Long orgId) {
        return Result.ok(deptService.tree(orgId));
    }

    @GetMapping("/{id}/subtree-ids")
    public Result<List<Long>> subtreeIds(@PathVariable Long id) {
        return Result.ok(deptService.subtreeIds(id));
    }

    @GetMapping("/{id}")
    public Result<DeptVO> get(@PathVariable Long id) {
        return Result.ok(deptService.getById(id));
    }

    @PostMapping
    public Result<DeptVO> create(@Valid @RequestBody DeptCreateRequest request) {
        return Result.ok(deptService.create(request));
    }

    @PutMapping("/{id}")
    public Result<DeptVO> update(@PathVariable Long id, @Valid @RequestBody DeptUpdateRequest request) {
        return Result.ok(deptService.update(id, request));
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        deptService.delete(id);
        return Result.ok();
    }
}
