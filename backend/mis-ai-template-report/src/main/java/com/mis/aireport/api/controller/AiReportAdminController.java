package com.mis.aireport.api.controller;

import com.mis.aireport.api.dto.AiParamSourceVO;
import com.mis.aireport.api.dto.AiReportAclSaveRequest;
import com.mis.aireport.api.dto.AiReportAclVO;
import com.mis.aireport.api.dto.AiReportCategorySaveRequest;
import com.mis.aireport.api.dto.AiReportCategoryVO;
import com.mis.aireport.api.dto.AiReportDefSaveRequest;
import com.mis.aireport.api.dto.AiReportDefVO;
import com.mis.aireport.api.dto.AiWorkflowPlatformSaveRequest;
import com.mis.aireport.api.dto.AiWorkflowPlatformVO;
import com.mis.aireport.domain.service.AiReportAdminService;
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

/**
 * 模板报告管理面 API（经 BFF 代理；权限码 ai-report:view / ai-report:save）。
 */
@RestController
@RequestMapping("/api/v1/ai-reports")
public class AiReportAdminController {

    private final AiReportAdminService adminService;

    public AiReportAdminController(AiReportAdminService adminService) {
        this.adminService = adminService;
    }

    @GetMapping("/categories/tree")
    public Result<List<AiReportCategoryVO>> categoryTree() {
        return Result.ok(adminService.listCategoryTree());
    }

    @PostMapping("/categories")
    public Result<AiReportCategoryVO> createCategory(@Valid @RequestBody AiReportCategorySaveRequest dto) {
        return Result.ok(adminService.createCategory(dto));
    }

    @PutMapping("/categories/{id}")
    public Result<AiReportCategoryVO> updateCategory(
            @PathVariable Long id, @Valid @RequestBody AiReportCategorySaveRequest dto) {
        return Result.ok(adminService.updateCategory(id, dto));
    }

    @DeleteMapping("/categories/{id}")
    public Result<Void> deleteCategory(@PathVariable Long id) {
        adminService.deleteCategory(id);
        return Result.ok();
    }

    @GetMapping("/param-sources")
    public Result<List<AiParamSourceVO>> listParamSources() {
        return Result.ok(adminService.listParamSources());
    }

    @GetMapping("/workflow-platforms")
    public Result<List<AiWorkflowPlatformVO>> listWorkflowPlatforms() {
        return Result.ok(adminService.listWorkflowPlatforms());
    }

    @PostMapping("/workflow-platforms")
    public Result<AiWorkflowPlatformVO> createWorkflowPlatform(
            @Valid @RequestBody AiWorkflowPlatformSaveRequest dto) {
        return Result.ok(adminService.createWorkflowPlatform(dto));
    }

    @PutMapping("/workflow-platforms/{id}")
    public Result<AiWorkflowPlatformVO> updateWorkflowPlatform(
            @PathVariable Long id, @Valid @RequestBody AiWorkflowPlatformSaveRequest dto) {
        return Result.ok(adminService.updateWorkflowPlatform(id, dto));
    }

    @GetMapping("/defs")
    public Result<List<AiReportDefVO>> listReports(
            @RequestParam(required = false) Long categoryId,
            @RequestParam(required = false, defaultValue = "false") boolean uncategorized) {
        return Result.ok(adminService.listReports(categoryId, uncategorized));
    }

    @GetMapping("/defs/{id}")
    public Result<AiReportDefVO> getReport(@PathVariable Long id) {
        return Result.ok(adminService.getReport(id));
    }

    @PostMapping("/defs")
    public Result<AiReportDefVO> createReport(@Valid @RequestBody AiReportDefSaveRequest dto) {
        return Result.ok(adminService.createReport(dto));
    }

    @PutMapping("/defs/{id}")
    public Result<AiReportDefVO> updateReport(
            @PathVariable Long id, @Valid @RequestBody AiReportDefSaveRequest dto) {
        return Result.ok(adminService.updateReport(id, dto));
    }

    @DeleteMapping("/defs/{id}")
    public Result<Void> deleteReport(@PathVariable Long id) {
        adminService.deleteReport(id);
        return Result.ok();
    }

    @GetMapping("/acls")
    public Result<List<AiReportAclVO>> listAcls(@RequestParam String reportCode) {
        return Result.ok(adminService.listAcls(reportCode));
    }

    @PostMapping("/acls")
    public Result<AiReportAclVO> createAcl(@Valid @RequestBody AiReportAclSaveRequest dto) {
        return Result.ok(adminService.createAcl(dto));
    }

    @DeleteMapping("/acls/{id}")
    public Result<Void> deleteAcl(@PathVariable Long id) {
        adminService.deleteAcl(id);
        return Result.ok();
    }
}
