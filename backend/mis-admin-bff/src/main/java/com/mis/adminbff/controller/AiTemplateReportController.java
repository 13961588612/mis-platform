package com.mis.adminbff.controller;

import com.mis.adminbff.client.AiTemplateReportClient;
import com.mis.common.core.result.Result;
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
import java.util.Map;

/**
 * 模板报告 BFF 代理（权限：ai-report:view / ai-report:save，见 V160）。
 */
@RestController
@RequestMapping("/api/v1/ai-reports")
public class AiTemplateReportController {

    private final AiTemplateReportClient client;

    public AiTemplateReportController(AiTemplateReportClient client) {
        this.client = client;
    }

    @GetMapping("/ping")
    public Result<Map<String, Object>> ping() {
        return Result.ok(client.ping());
    }

    @GetMapping("/categories/tree")
    public Result<List<Map<String, Object>>> categoryTree() {
        return Result.ok(client.categoryTree());
    }

    @PostMapping("/categories")
    public Result<Map<String, Object>> createCategory(@RequestBody Map<String, Object> body) {
        return Result.ok(client.createCategory(body));
    }

    @PutMapping("/categories/{id}")
    public Result<Map<String, Object>> updateCategory(
            @PathVariable Long id, @RequestBody Map<String, Object> body) {
        return Result.ok(client.updateCategory(id, body));
    }

    @DeleteMapping("/categories/{id}")
    public Result<Void> deleteCategory(@PathVariable Long id) {
        client.deleteCategory(id);
        return Result.ok();
    }

    @GetMapping("/param-sources")
    public Result<List<Map<String, Object>>> listParamSources() {
        return Result.ok(client.listParamSources());
    }

    @GetMapping("/workflow-platforms")
    public Result<List<Map<String, Object>>> listWorkflowPlatforms() {
        return Result.ok(client.listWorkflowPlatforms());
    }

    @PostMapping("/workflow-platforms")
    public Result<Map<String, Object>> createWorkflowPlatform(@RequestBody Map<String, Object> body) {
        return Result.ok(client.createWorkflowPlatform(body));
    }

    @PutMapping("/workflow-platforms/{id}")
    public Result<Map<String, Object>> updateWorkflowPlatform(
            @PathVariable Long id, @RequestBody Map<String, Object> body) {
        return Result.ok(client.updateWorkflowPlatform(id, body));
    }

    @GetMapping("/defs")
    public Result<List<Map<String, Object>>> listReports(
            @RequestParam(required = false) Long categoryId,
            @RequestParam(required = false, defaultValue = "false") boolean uncategorized) {
        return Result.ok(client.listReports(categoryId, uncategorized));
    }

    @GetMapping("/defs/{id}")
    public Result<Map<String, Object>> getReport(@PathVariable Long id) {
        return Result.ok(client.getReport(id));
    }

    @PostMapping("/defs")
    public Result<Map<String, Object>> createReport(@RequestBody Map<String, Object> body) {
        return Result.ok(client.createReport(body));
    }

    @PutMapping("/defs/{id}")
    public Result<Map<String, Object>> updateReport(
            @PathVariable Long id, @RequestBody Map<String, Object> body) {
        return Result.ok(client.updateReport(id, body));
    }

    @DeleteMapping("/defs/{id}")
    public Result<Void> deleteReport(@PathVariable Long id) {
        client.deleteReport(id);
        return Result.ok();
    }

    @GetMapping("/acls")
    public Result<List<Map<String, Object>>> listAcls(@RequestParam String reportCode) {
        return Result.ok(client.listAcls(reportCode));
    }

    @PostMapping("/acls")
    public Result<Map<String, Object>> createAcl(@RequestBody Map<String, Object> body) {
        return Result.ok(client.createAcl(body));
    }

    @DeleteMapping("/acls/{id}")
    public Result<Void> deleteAcl(@PathVariable Long id) {
        client.deleteAcl(id);
        return Result.ok();
    }

    @GetMapping("/catalog")
    public Result<List<Map<String, Object>>> catalog() {
        return Result.ok(client.catalog());
    }

    @PostMapping("/prepare-card")
    public Result<Map<String, Object>> prepareCard(@RequestBody Map<String, Object> body) {
        return Result.ok(client.prepareCard(body));
    }

    @PostMapping("/execute")
    public Result<Map<String, Object>> execute(@RequestBody Map<String, Object> body) {
        return Result.ok(client.execute(body));
    }

    @PostMapping("/results")
    public Result<Map<String, Object>> saveResult(@RequestBody Map<String, Object> body) {
        return Result.ok(client.saveResult(body));
    }
}
