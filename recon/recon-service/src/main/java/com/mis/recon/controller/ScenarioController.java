package com.mis.recon.controller;

import com.mis.recon.common.ApiResponse;
import com.mis.recon.common.PageResult;
import com.mis.recon.domain.config.ReconScenario;
import com.mis.recon.domain.dto.ScenarioSaveReq;
import com.mis.recon.service.config.ScenarioService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 场景配置端点（F115）。
 */
@RestController
@RequestMapping("/internal/v1/recon/scenarios")
@RequiredArgsConstructor
public class ScenarioController {

    private final ScenarioService scenarioService;

    @GetMapping
    public ApiResponse<PageResult<ReconScenario>> page(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Integer enabled) {
        return ApiResponse.ok(scenarioService.page(PageSupport.normalize(page, size), keyword, enabled));
    }

    @GetMapping("/{code}")
    public ApiResponse<ReconScenario> get(@PathVariable String code) {
        return ApiResponse.ok(scenarioService.get(code));
    }

    @PostMapping
    public ApiResponse<ReconScenario> create(@Valid @RequestBody ScenarioSaveReq req) {
        return ApiResponse.ok(scenarioService.save(req));
    }

    @PutMapping("/{code}")
    public ApiResponse<ReconScenario> update(@PathVariable String code,
                                             @Valid @RequestBody ScenarioSaveReq req) {
        return ApiResponse.ok(scenarioService.update(code, req));
    }

    @DeleteMapping("/{code}")
    public ApiResponse<Void> delete(@PathVariable String code) {
        scenarioService.delete(code);
        return ApiResponse.ok();
    }
}
