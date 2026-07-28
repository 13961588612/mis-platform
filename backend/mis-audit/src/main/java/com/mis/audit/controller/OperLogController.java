package com.mis.audit.controller;

import com.mis.audit.dto.CreateOperLogRequest;
import com.mis.audit.dto.OperLogVO;
import com.mis.audit.service.OperLogService;
import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/internal/v1/oper-logs", "/api/v1/audit/oper-logs"})
public class OperLogController {

    private final OperLogService operLogService;

    public OperLogController(OperLogService operLogService) {
        this.operLogService = operLogService;
    }

    @GetMapping
    public Result<PageResult<OperLogVO>> page(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String module,
            @RequestParam(required = false) String username) {
        return Result.ok(operLogService.page(page, size, module, username));
    }

    @PostMapping
    public Result<Void> create(@Valid @RequestBody CreateOperLogRequest request) {
        operLogService.create(request);
        return Result.ok();
    }
}
