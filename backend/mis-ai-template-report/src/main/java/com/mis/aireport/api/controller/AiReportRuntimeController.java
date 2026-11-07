package com.mis.aireport.api.controller;

import com.mis.aireport.domain.service.AiReportRuntimeService;
import com.mis.common.core.result.Result;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * Copilot / Agent 运行时：分组目录、参数卡准备、执行（S3）。
 */
@RestController
@RequestMapping("/api/v1/ai-reports")
public class AiReportRuntimeController {

    private final AiReportRuntimeService runtimeService;

    public AiReportRuntimeController(AiReportRuntimeService runtimeService) {
        this.runtimeService = runtimeService;
    }

    @GetMapping("/catalog")
    public Result<List<Map<String, Object>>> catalog() {
        return Result.ok(runtimeService.catalog());
    }

    @PostMapping("/prepare-card")
    public Result<Map<String, Object>> prepareCard(@RequestBody Map<String, Object> body) {
        String reportCode = String.valueOf(body.getOrDefault("reportCode", body.getOrDefault("report_code", "")));
        return Result.ok(runtimeService.prepareCard(reportCode));
    }

    @PostMapping("/execute")
    public Result<Map<String, Object>> execute(@RequestBody Map<String, Object> body) {
        return Result.ok(runtimeService.execute(body == null ? Map.of() : body));
    }

    @PostMapping("/results")
    public Result<Map<String, Object>> saveResult(@RequestBody Map<String, Object> body) {
        return Result.ok(runtimeService.saveResult(body == null ? Map.of() : body));
    }
}
