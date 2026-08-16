package com.mis.adminbff.controller;

import com.mis.adminbff.client.model.DeptPierceVO;
import com.mis.adminbff.client.model.DeptStaffingVO;
import com.mis.adminbff.client.model.DeptVO;
import com.mis.adminbff.dto.DeptCreateRequest;
import com.mis.adminbff.dto.DeptUpdateRequest;
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
@RequestMapping("/api/v1/depts")
public class DeptController {

    private final OrgFacadeService orgFacadeService;

    public DeptController(OrgFacadeService orgFacadeService) {
        this.orgFacadeService = orgFacadeService;
    }

    @GetMapping("/tree")
    public Result<List<DeptVO>> tree(@RequestParam Long orgId) {
        return Result.ok(orgFacadeService.deptTree(orgId));
    }

    /** V40 组织穿透：只读 GET（字面量优先于 /{id}，与 /tree 同理）。 */
    @GetMapping("/pierce")
    public Result<List<DeptPierceVO>> pierce(@RequestParam Long orgId) {
        return Result.ok(orgFacadeService.deptPierce(orgId));
    }

    /**
     * 部门岗位编制：三指标 + 各岗位任职明细 + 部门任职人员。
     * tenantId 由 BFF 经 RequestContext 注入（前端不传）。
     */
    @GetMapping("/{id}/staffing")
    public Result<DeptStaffingVO> staffing(@PathVariable Long id) {
        return Result.ok(orgFacadeService.getDeptStaffing(id));
    }

    @GetMapping("/{id}")
    public Result<DeptVO> get(@PathVariable Long id) {
        return Result.ok(orgFacadeService.getDept(id));
    }

    @PostMapping
    public Result<DeptVO> create(@Valid @RequestBody DeptCreateRequest request) {
        return Result.ok(orgFacadeService.createDept(request));
    }

    @PutMapping("/{id}")
    public Result<DeptVO> update(@PathVariable Long id, @Valid @RequestBody DeptUpdateRequest request) {
        return Result.ok(orgFacadeService.updateDept(id, request));
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        orgFacadeService.deleteDept(id);
        return Result.ok();
    }
}
