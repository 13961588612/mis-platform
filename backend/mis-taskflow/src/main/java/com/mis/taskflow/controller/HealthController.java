package com.mis.taskflow.controller;

import com.mis.common.core.result.Result;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 服务探针与阶段占位接口；P1 用于验证 BFF -> taskflow 链路。
 */
@RestController
@RequestMapping("/internal/v1/taskflow")
public class HealthController {

    @GetMapping("/health")
    public Result<Map<String, Object>> health() {
        return Result.ok(Map.of(
                "service", "mis-taskflow",
                "status", "UP"
        ));
    }
}