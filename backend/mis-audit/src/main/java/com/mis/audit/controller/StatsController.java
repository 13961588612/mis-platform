package com.mis.audit.controller;

import com.mis.audit.domain.repository.LoginLogRepository;
import com.mis.common.core.result.Result;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Map;

@RestController
@RequestMapping("/internal/v1/stats")
public class StatsController {

    private final LoginLogRepository loginLogRepository;

    public StatsController(LoginLogRepository loginLogRepository) {
        this.loginLogRepository = loginLogRepository;
    }

    @GetMapping("/today-logins")
    public Result<Map<String, Long>> todayLogins(
            @RequestParam Long tenantId,
            @RequestParam Long appId) {
        ZoneId zone = ZoneId.systemDefault();
        LocalDate today = LocalDate.now(zone);
        Instant start = today.atStartOfDay(zone).toInstant();
        Instant end = today.plusDays(1).atStartOfDay(zone).toInstant();
        long count = loginLogRepository.countSuccessBetween(tenantId, appId, start, end);
        return Result.ok(Map.of("count", count));
    }
}
