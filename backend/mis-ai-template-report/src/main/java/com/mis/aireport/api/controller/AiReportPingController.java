package com.mis.aireport.api.controller;

import com.mis.common.core.result.Result;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * S1 探活：供 BFF / 本地验证服务已启动（业务 CRUD 见后续阶段）。
 */
@RestController
@RequestMapping("/api/v1/ai-reports")
public class AiReportPingController {

    @GetMapping("/ping")
    public Result<Map<String, Object>> ping() {
        return Result.ok(Map.of(
                "service", "mis-ai-template-report",
                "status", "up"));
    }
}
