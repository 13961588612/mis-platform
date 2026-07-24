package com.mis.system.controller;

import com.mis.common.core.result.Result;
import com.mis.system.dto.ApiPermissionRuleVO;
import com.mis.system.dto.ApiVO;
import com.mis.system.service.ApiService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/internal/v1")
public class ApiController {

    private final ApiService apiService;

    public ApiController(ApiService apiService) {
        this.apiService = apiService;
    }

    @GetMapping("/apis/tree")
    public Result<List<ApiVO>> tree(@RequestParam Long appId) {
        return Result.ok(apiService.tree(appId));
    }

    @GetMapping("/api-permissions/registry")
    public Result<List<ApiPermissionRuleVO>> registry() {
        return Result.ok(apiService.registry());
    }
}
