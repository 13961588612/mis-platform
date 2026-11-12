package com.mis.adminbff.client.model;

import java.time.LocalDateTime;

public record AuditTimelineItem(
        String id, String operationType, String description, String username,
        String resultStatus, String diffSummary, LocalDateTime operTime) {
}