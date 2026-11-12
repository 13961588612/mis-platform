package com.mis.taskflow.dto;

import java.time.LocalDateTime;

/**
 * 后置执行任务视图（P6 监控看板）。
 */
public record ExecutionTaskVO(
        String id,
        String sourceInstanceId,
        String actionType,
        String bizType,
        String bizRefId,
        String txStatus,
        Integer retryCount,
        LocalDateTime nextRetryAt,
        String errorMsg,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
}
