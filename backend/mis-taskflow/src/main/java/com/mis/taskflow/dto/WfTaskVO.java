package com.mis.taskflow.dto;

import java.time.LocalDateTime;

public record WfTaskVO(
        String id,
        String instanceId,
        String nodeCode,
        String nodeName,
        String taskType,
        String sysTaskId,
        String assigneeId,
        String assigneeName,
        String status,
        LocalDateTime dueDate,
        LocalDateTime createdAt,
        LocalDateTime completedAt
) {
}
