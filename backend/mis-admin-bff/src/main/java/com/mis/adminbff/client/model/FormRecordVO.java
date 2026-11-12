package com.mis.adminbff.client.model;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * 表单单据视图（透传 mis-taskflow）。
 */
public record FormRecordVO(
        String id,
        String formCode,
        String status,
        String storageTable,
        String dataId,
        String currentInstanceId,
        String lastInstanceId,
        String title,
        Map<String, Object> values,
        String payloadSnapshot,
        String createdBy,
        String createdByName,
        LocalDateTime createdAt,
        LocalDateTime updatedAt,
        boolean canEdit,
        boolean canStartProcess,
        boolean canWithdraw
) {
}
