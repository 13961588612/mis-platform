package com.mis.recon.controller;

import com.mis.recon.common.ApiResponse;
import com.mis.recon.common.PageResult;
import com.mis.recon.domain.config.ReconReporterConfig;
import com.mis.recon.domain.dto.ReporterSaveReq;
import com.mis.recon.service.report.ReporterService;
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
 * 报告渠道配置端点（T07-spec §7，G32）。
 */
@RestController
@RequestMapping("/internal/v1/recon/reporters")
@RequiredArgsConstructor
public class ReporterController {

    private final ReporterService reporterService;

    @GetMapping
    public ApiResponse<PageResult<ReconReporterConfig>> page(
            @RequestParam(required = false) String scenarioCode,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(reporterService.page(scenarioCode, PageSupport.normalize(page, size)));
    }

    @PostMapping
    public ApiResponse<ReconReporterConfig> create(@Valid @RequestBody ReporterSaveReq req) {
        return ApiResponse.ok(reporterService.save(req));
    }

    @PutMapping("/{id}")
    public ApiResponse<ReconReporterConfig> update(@PathVariable Long id,
                                                   @Valid @RequestBody ReporterSaveReq req) {
        return ApiResponse.ok(reporterService.update(id, req));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        reporterService.delete(id);
        return ApiResponse.ok();
    }
}