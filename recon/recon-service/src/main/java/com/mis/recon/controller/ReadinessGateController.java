package com.mis.recon.controller;

import com.mis.recon.common.ApiResponse;
import com.mis.recon.common.PageResult;
import com.mis.recon.domain.config.ReconReadinessGate;
import com.mis.recon.domain.dto.ReadinessGateSaveReq;
import com.mis.recon.service.config.ReadinessGateService;
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
 * 数据就绪门端点（T07-spec §7，G31）。
 */
@RestController
@RequestMapping("/internal/v1/recon/readiness-gates")
@RequiredArgsConstructor
public class ReadinessGateController {

    private final ReadinessGateService readinessGateService;

    @GetMapping
    public ApiResponse<PageResult<ReconReadinessGate>> page(
            @RequestParam(required = false) String scenarioCode,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(readinessGateService.page(scenarioCode, PageSupport.normalize(page, size)));
    }

    @PostMapping
    public ApiResponse<ReconReadinessGate> create(@Valid @RequestBody ReadinessGateSaveReq req) {
        return ApiResponse.ok(readinessGateService.save(req));
    }

    @PutMapping("/{id}")
    public ApiResponse<ReconReadinessGate> update(@PathVariable Long id,
                                                  @Valid @RequestBody ReadinessGateSaveReq req) {
        return ApiResponse.ok(readinessGateService.update(id, req));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        readinessGateService.delete(id);
        return ApiResponse.ok();
    }
}