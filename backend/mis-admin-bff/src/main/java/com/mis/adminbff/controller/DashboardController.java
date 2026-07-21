package com.mis.adminbff.controller;

import com.mis.adminbff.dto.DashboardStatsVO;
import com.mis.adminbff.service.DashboardAggregateService;
import com.mis.common.core.result.Result;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/dashboard")
public class DashboardController {

    private final DashboardAggregateService dashboardAggregateService;

    public DashboardController(DashboardAggregateService dashboardAggregateService) {
        this.dashboardAggregateService = dashboardAggregateService;
    }

    @GetMapping("/stats")
    public Result<DashboardStatsVO> stats() {
        return Result.ok(dashboardAggregateService.stats());
    }
}
