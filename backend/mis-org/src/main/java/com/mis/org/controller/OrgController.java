package com.mis.org.controller;

import com.mis.common.core.result.Result;
import com.mis.org.dto.OrgCreateRequest;
import com.mis.org.dto.OrgUpdateRequest;
import com.mis.org.dto.OrgVO;
import com.mis.org.service.OrgService;
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
@RequestMapping("/internal/v1/orgs")
public class OrgController {

    private final OrgService orgService;

    public OrgController(OrgService orgService) {
        this.orgService = orgService;
    }

    @GetMapping
    public Result<List<OrgVO>> list(@RequestParam Long tenantId) {
        return Result.ok(orgService.listByTenant(tenantId));
    }

    @GetMapping("/{id}")
    public Result<OrgVO> get(@PathVariable Long id) {
        return Result.ok(orgService.getById(id));
    }

    @PostMapping
    public Result<OrgVO> create(@Valid @RequestBody OrgCreateRequest request) {
        return Result.ok(orgService.create(request));
    }

    @PutMapping("/{id}")
    public Result<OrgVO> update(@PathVariable Long id, @Valid @RequestBody OrgUpdateRequest request) {
        return Result.ok(orgService.update(id, request));
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        orgService.delete(id);
        return Result.ok();
    }
}
