package com.mis.taskflow.dto;

/**
 * 待办统计（角标数据）。
 *
 * @param pending 待处理
 * @param urgent  紧急（priority = 4）
 * @param overdue 已逾期
 */
public record TaskStatsVO(long pending, long urgent, long overdue) {
}