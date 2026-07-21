package com.mis.adminbff.controller;

import com.mis.adminbff.client.model.OrgVO;
import com.mis.adminbff.dto.OrgCreateRequest;
import com.mis.adminbff.dto.OrgUpdateRequest;
import com.mis.adminbff.service.OrgFacadeService;
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
@RequestMapping("/api/v1/orgs")
public class OrgController {

    private final OrgFacadeService orgFacadeService;

    public OrgController(OrgFacadeService orgFacadeService) {
        this.orgFacadeService = orgFacadeService;
    }

    @GetMapping
    public Result<List<OrgVO>> list() {
        return Result.ok(orgFacadeService.listOrgs());
    }

    @GetMapping("/{id}")
    public Result<OrgVO> get(@PathVariable Long id) {
        return Result.ok(orgFacadeService.getOrg(id));
    }

    @PostMapping
    public Result<OrgVO> create(@Valid @RequestBody OrgCreateRequest request) {
        return Result.ok(orgFacadeService.createOrg(request));
    }

    @PutMapping("/{id}")
    public Result<OrgVO> update(@PathVariable Long id, @Valid @RequestBody OrgUpdateRequest request) {
        return Result.ok(orgFacadeService.updateOrg(id, request));
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        orgFacadeService.deleteOrg(id);
        return Result.ok();
    }
}
