package com.mis.adminbff.dto;

public record DashboardStatsVO(
        long userCount,
        long orgCount,
        long todayLoginCount,
        long onlineUserCount
) {
}
