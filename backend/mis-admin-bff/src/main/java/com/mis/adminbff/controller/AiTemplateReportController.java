package com.mis.adminbff.controller;

import com.mis.adminbff.client.AiTemplateReportClient;
import com.mis.common.core.result.Result;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 模板报告 BFF 代理（S1：ping 占位；完整 API 与权限种子见 S2）。
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
}
