package com.mis.kb.api.controller;

import com.mis.common.core.result.Result;
import com.mis.kb.domain.model.EngineCapabilities;
import com.mis.kb.domain.model.EngineHealth;
import com.mis.kb.domain.service.KbEngineConfigService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 引擎配置与连通性端点（S-04，内部端点供 BFF 聚合）。
 */
@RestController
@RequestMapping("/internal/v1/kb/engine")
public class EngineConfigController {

    private final KbEngineConfigService engineConfigService;

    public EngineConfigController(KbEngineConfigService engineConfigService) {
        this.engineConfigService = engineConfigService;
    }

    /** 引擎健康检查（连通性）。 */
    @GetMapping("/health")
    public Result<EngineHealth> health() {
        return Result.ok(engineConfigService.health());
    }

    /** 引擎能力声明。 */
    @GetMapping("/capabilities")
    public Result<EngineCapabilities> capabilities() {
        return Result.ok(engineConfigService.capabilities());
    }

    /** 当前生效引擎类型。 */
    @GetMapping("/type")
    public Result<String> engineType() {
        return Result.ok(engineConfigService.engineType());
    }
}
