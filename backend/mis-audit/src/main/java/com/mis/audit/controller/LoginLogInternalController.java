package com.mis.audit.controller;

import com.mis.audit.dto.CreateLoginLogRequest;
import com.mis.audit.service.LoginLogService;
import com.mis.common.core.result.Result;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/v1/login-logs")
public class LoginLogInternalController {

    private final LoginLogService loginLogService;

    public LoginLogInternalController(LoginLogService loginLogService) {
        this.loginLogService = loginLogService;
    }

    @PostMapping
    public Result<Void> create(@Valid @RequestBody CreateLoginLogRequest request) {
        loginLogService.create(request);
        return Result.ok();
    }
}
