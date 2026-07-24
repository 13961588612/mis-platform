package com.mis.iam.controller;

import com.mis.common.core.result.Result;
import com.mis.iam.domain.repository.SysUserRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/internal/v1/stats")
public class StatsController {

    private final SysUserRepository userRepository;

    public StatsController(SysUserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @GetMapping("/users")
    public Result<Map<String, Long>> userCount(
            @RequestParam Long tenantId,
            @RequestParam Long appId) {
        return Result.ok(Map.of("count", userRepository.countByTenantIdAndAppId(tenantId, appId)));
    }
}
