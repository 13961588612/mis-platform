package com.mis.auth.controller;

import com.mis.auth.domain.repository.RefreshTokenRepository;
import com.mis.common.core.result.Result;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Map;

@RestController
@RequestMapping("/internal/v1/stats")
public class StatsController {

    private final RefreshTokenRepository refreshTokenRepository;

    public StatsController(RefreshTokenRepository refreshTokenRepository) {
        this.refreshTokenRepository = refreshTokenRepository;
    }

    @GetMapping("/online-users")
    public Result<Map<String, Long>> onlineUsers(@RequestParam Long appId) {
        long count = refreshTokenRepository.countOnlineUsers(appId, Instant.now());
        return Result.ok(Map.of("count", count));
    }
}
