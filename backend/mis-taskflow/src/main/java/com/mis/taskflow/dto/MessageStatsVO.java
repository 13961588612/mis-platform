package com.mis.taskflow.dto;

/**
 * 消息统计（角标数据）。
 *
 * @param unread 未读消息数
 * @param total  消息总数
 */
public record MessageStatsVO(long unread, long total) {
}