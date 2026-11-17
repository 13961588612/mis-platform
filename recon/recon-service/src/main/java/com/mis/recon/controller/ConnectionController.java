package com.mis.recon.controller;

import com.mis.recon.common.ApiResponse;
import com.mis.recon.common.PageResult;
import com.mis.recon.domain.config.ReconConnection;
import com.mis.recon.domain.dto.ConnectionSaveReq;
import com.mis.recon.service.config.ConnectionService;
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
 * 连接配置端点（F113）。
 */
@RestController
@RequestMapping("/internal/v1/recon/connections")
@RequiredArgsConstructor
public class ConnectionController {

    private final ConnectionService connectionService;

    @GetMapping
    public ApiResponse<PageResult<ReconConnection>> page(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Integer enabled) {
        return ApiResponse.ok(connectionService.page(PageSupport.normalize(page, size), keyword, enabled));
    }

    @GetMapping("/{code}")
    public ApiResponse<ReconConnection> get(@PathVariable String code) {
        return ApiResponse.ok(connectionService.get(code));
    }

    @PostMapping
    public ApiResponse<ReconConnection> create(@Valid @RequestBody ConnectionSaveReq req) {
        return ApiResponse.ok(connectionService.save(req));
    }

    @PutMapping("/{code}")
    public ApiResponse<ReconConnection> update(@PathVariable String code,
                                               @Valid @RequestBody ConnectionSaveReq req) {
        return ApiResponse.ok(connectionService.update(code, req));
    }

    @DeleteMapping("/{code}")
    public ApiResponse<Void> delete(@PathVariable String code) {
        connectionService.delete(code);
        return ApiResponse.ok();
    }

    @PostMapping("/{code}/test")
    public ApiResponse<Void> test(@PathVariable String code) {
        connectionService.testConnection(code);
        return ApiResponse.ok();
    }
}
