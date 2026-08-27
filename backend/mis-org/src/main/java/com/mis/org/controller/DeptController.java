package com.mis.org.controller;

import com.mis.common.core.result.Result;
import com.mis.org.dto.DeptCreateRequest;
import com.mis.org.dto.DeptPierceVO;
import com.mis.org.dto.DeptStaffingVO;
import com.mis.org.dto.DeptTypeCreateRequest;
import com.mis.org.dto.DeptTypeTreeNodeVO;
import com.mis.org.dto.DeptTypeUpdateRequest;
import com.mis.org.dto.DeptTypeVO;
import com.mis.org.dto.DeptUpdateRequest;
import com.mis.org.dto.DeptVO;
import com.mis.org.service.DeptService;
import com.mis.org.service.DeptStaffingService;
import com.mis.org.service.DeptTypeService;
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
@RequestMapping("/internal/v1")
public class DeptController {

    private final DeptService deptService;
    private final DeptStaffingService staffingService;
    private final DeptTypeService deptTypeService;

    public DeptController(DeptService deptService, DeptStaffingService staffingService, DeptTypeService deptTypeService) {
        this.deptService = deptService;
        this.staffingService = staffingService;
        this.deptTypeService = deptTypeService;
    }

    @GetMapping("/depts/tree")
    public Result<List<DeptVO>> tree(@RequestParam Long orgId) {
        return Result.ok(deptService.tree(orgId));
    }

    /** V40 组织穿透：只读 GET，返回该组织顶级部门树 forest（懒加载）。 */
    @GetMapping("/depts/pierce")
    public Result<List<DeptPierceVO>> pierce(@RequestParam Long orgId) {
        return Result.ok(deptService.pierce(orgId));
    }

    @GetMapping("/depts/{id}/subtree-ids")
    public Result<List<Long>> subtreeIds(@PathVariable Long id) {
        return Result.ok(deptService.subtreeIds(id));
    }

    @GetMapping("/depts/{id}")
    public Result<DeptVO> get(@PathVariable Long id) {
        return Result.ok(deptService.getById(id));
    }

    @GetMapping("/depts/{id}/staffing")
    public Result<DeptStaffingVO> staffing(@PathVariable Long id, @RequestParam Long tenantId) {
        return Result.ok(staffingService.staffing(tenantId, id));
    }

    @PostMapping("/depts")
    public Result<DeptVO> create(@Valid @RequestBody DeptCreateRequest request) {
        return Result.ok(deptService.create(request));
    }

    @PutMapping("/depts/{id}")
    public Result<DeptVO> update(@PathVariable Long id, @Valid @RequestBody DeptUpdateRequest request) {
        return Result.ok(deptService.update(id, request));
    }

    @DeleteMapping("/depts/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        deptService.delete(id);
        return Result.ok();
    }

    /**
     * V54 部门类型列表：status 可选（null=全量含禁用，1=仅启用）；返回含 referenceCount。
     */
    @GetMapping("/dept-types")
    public Result<List<DeptTypeVO>> listTypes(
            @RequestParam Long tenantId,
            @RequestParam(required = false) Integer status) {
        return Result.ok(deptTypeService.listTypes(tenantId, status));
    }

    /** V54 部门类型树：按 parent_id 递归组装（顶层 parentId=0）。 */
    @GetMapping("/dept-types/tree")
    public Result<List<DeptTypeTreeNodeVO>> listTypeTree(
            @RequestParam Long tenantId,
            @RequestParam(required = false) Integer status) {
        return Result.ok(deptTypeService.listTypeTree(tenantId, status));
    }

    @PostMapping("/dept-types")
    public Result<DeptTypeVO> createType(@Valid @RequestBody DeptTypeCreateRequest request) {
        return Result.ok(deptTypeService.createType(request));
    }

    @PutMapping("/dept-types/{id}")
    public Result<DeptTypeVO> updateType(@PathVariable Long id, @Valid @RequestBody DeptTypeUpdateRequest request) {
        return Result.ok(deptTypeService.updateType(id, request));
    }

    @DeleteMapping("/dept-types/{id}")
    public Result<Void> deleteType(@PathVariable Long id) {
        deptTypeService.deleteType(id);
        return Result.ok();
    }
}
