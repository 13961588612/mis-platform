package com.mis.taskflow.dto;

import java.time.LocalDateTime;

public record WfHistoryVO(
        String id,
        String nodeCode,
        String operatorId,
        String operatorName,
        String operation,
        String fromNode,
        String toNode,
        String comment,
        LocalDateTime createdAt
) {
}
