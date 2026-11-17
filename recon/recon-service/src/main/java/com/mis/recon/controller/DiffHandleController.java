package com.mis.recon.controller;

import com.mis.recon.common.ApiResponse;
import com.mis.recon.domain.dto.DiffHandleReq;
import com.mis.recon.domain.dto.RevertReq;
import com.mis.recon.service.engine.DiffHandleService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 差异人工处理端点（T07-spec §6，G30；V4 加回退）。
 */
@RestController
@RequestMapping("/internal/v1/recon/diffs")
@RequiredArgsConstructor
public class DiffHandleController {

    private final DiffHandleService diffHandleService;

    @PostMapping("/{id}/handle")
    public ApiResponse<Map<String, Long>> handle(@PathVariable Long id,
                                                 @Valid @RequestBody DiffHandleReq req) {
        return ApiResponse.ok(Map.of("id", diffHandleService.handle(id, req)));
    }

    /** 回退为未处理（V4）。 */
    @PostMapping("/{id}/revert")
    public ApiResponse<Map<String, Long>> revert(@PathVariable Long id,
                                                 @Valid @RequestBody RevertReq req) {
        return ApiResponse.ok(Map.of("id", diffHandleService.revert(id, req.getOperator(), req.getRemark())));
    }
}