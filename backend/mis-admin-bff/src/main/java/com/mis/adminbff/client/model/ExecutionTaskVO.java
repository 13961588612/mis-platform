package com.mis.adminbff.client.model;

import java.time.LocalDateTime;

public record ExecutionTaskVO(
        String id, String sourceInstanceId, String actionType, String bizType, String bizRefId,
        String txStatus, Integer retryCount, LocalDateTime nextRetryAt, String errorMsg,
        LocalDateTime createdAt, LocalDateTime updatedAt) {
}