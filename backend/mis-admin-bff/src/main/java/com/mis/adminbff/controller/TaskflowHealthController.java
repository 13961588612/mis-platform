package com.mis.adminbff.controller;

import com.mis.adminbff.client.TaskflowWebClient;
import com.mis.common.core.result.Result;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 任务流探针（BFF 对外）。
 *
 * <p>网关统一路由 /api/v1/** 到 BFF，因此无需在 gateway 增加单独路由。
 */
@RestController
@RequestMapping("/api/v1/taskflow")
public class TaskflowHealthController {

    private final TaskflowWebClient taskflowWebClient;

    public TaskflowHealthController(TaskflowWebClient taskflowWebClient) {
        this.taskflowWebClient = taskflowWebClient;
    }

    @GetMapping("/health")
    public Result<Map<String, Object>> health() {
        return Result.ok(taskflowWebClient.health());
    }
}