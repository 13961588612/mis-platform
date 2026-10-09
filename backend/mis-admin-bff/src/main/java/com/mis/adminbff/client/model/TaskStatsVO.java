package com.mis.adminbff.client.model;

/** 待办统计（角标）。 */
public record TaskStatsVO(long pending, long urgent, long overdue) {
}