package com.mis.adminbff.controller;

import com.mis.adminbff.client.model.EmployeeVO;
import com.mis.adminbff.service.OrgFacadeService;
import com.mis.common.core.result.Result;
import org.springframework.web.bind.annotation.GetMapping;
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

    @GetMapping
    public Result<List<EmployeeVO>> listByDept(@RequestParam Long deptId) {
        return Result.ok(orgFacadeService.listEmployees(deptId));
    }
}
