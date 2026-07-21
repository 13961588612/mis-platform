package com.mis.iam.controller;

import com.mis.common.core.result.Result;
import com.mis.iam.dto.AppVO;
import com.mis.iam.service.AppService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/internal/v1/apps")
public class AppController {

    private final AppService appService;

    public AppController(AppService appService) {
        this.appService = appService;
    }

    @GetMapping
    public Result<List<AppVO>> list(
            @RequestParam Long tenantId,
            @RequestParam(required = false) String kind) {
        if ("subsystem".equalsIgnoreCase(kind)) {
            return Result.ok(appService.listPortalSubsystems(tenantId));
        }
        return Result.ok(appService.listByTenant(tenantId));
    }
}