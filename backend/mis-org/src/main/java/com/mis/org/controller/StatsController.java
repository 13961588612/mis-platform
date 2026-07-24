package com.mis.org.controller;

import com.mis.common.core.result.Result;
import com.mis.org.domain.repository.SysOrgRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/internal/v1/stats")
public class StatsController {

    private final SysOrgRepository orgRepository;

    public StatsController(SysOrgRepository orgRepository) {
        this.orgRepository = orgRepository;
    }

    @GetMapping("/orgs")
    public Result<Map<String, Long>> orgCount(@RequestParam Long tenantId) {
        return Result.ok(Map.of("count", orgRepository.countByTenantId(tenantId)));
    }
}
