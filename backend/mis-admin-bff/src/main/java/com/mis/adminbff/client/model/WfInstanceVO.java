package com.mis.adminbff.client.model;

import java.time.LocalDateTime;

public record WfInstanceVO(
        String id, String definitionCode, String startedFormCode, String businessType, String businessId,
        String status, String initiatorId, String initiatorName, String currentNodeCode, String currentNodeName,
        String progress, String postProcessStatus, Integer postRetryCount, LocalDateTime createdAt,
        LocalDateTime completedAt, String appCode) {
}
