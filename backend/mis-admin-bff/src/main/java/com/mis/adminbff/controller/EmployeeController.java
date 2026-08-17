package com.mis.adminbff.controller;

import com.mis.adminbff.client.model.EmployeeVO;
import com.mis.adminbff.dto.EmployeeCreateRequest;
import com.mis.adminbff.dto.EmployeeUpdateRequest;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/employees")
public class EmployeeController {

    private final OrgFacadeService orgFacadeService;

    public EmployeeController(OrgFacadeService orgFacadeService) {
        this.orgFacadeService = orgFacadeService;
    }

    /** 全量列表（含禁用；realName/deptId/deptIds/orgIds/status 可选），数据量小全量返回，前端分页/筛选。 */
    @GetMapping
    public Result<List<EmployeeVO>> list(
            @RequestParam(required = false) String realName,
            @RequestParam(required = false) Long deptId,
            @RequestParam(required = false) List<Long> deptIds,
            @RequestParam(required = false) List<Long> orgIds,
            @RequestParam(required = false) Integer status) {
        return Result.ok(orgFacadeService.listAllEmployees(realName, deptId, status, deptIds, orgIds));
    }

    @GetMapping("/{id}")
    public Result<EmployeeVO> get(@PathVariable Long id) {
        return Result.ok(orgFacadeService.getEmployee(id));
    }

    @PostMapping
    public Result<EmployeeVO> create(@Valid @RequestBody EmployeeCreateRequest request) {
        return Result.ok(orgFacadeService.createEmployee(request));
    }

    @PutMapping("/{id}")
    public Result<EmployeeVO> update(@PathVariable Long id, @Valid @RequestBody EmployeeUpdateRequest request) {
        return Result.ok(orgFacadeService.updateEmployee(id, request));
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        orgFacadeService.deleteEmployee(id);
        return Result.ok();
    }
}
