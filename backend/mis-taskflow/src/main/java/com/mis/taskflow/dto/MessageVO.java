package com.mis.taskflow.dto;

import java.time.LocalDateTime;

/**
 * 收件箱消息视图。
 *
 * @param read 当前用户的已读状态（来自明细表，而非主表聚合）
 */
public record MessageVO(
        String id,
        String tenantId,
        String msgType,
        String category,
        String title,
        String summary,
        String senderId,
        String senderName,
        String referenceTaskId,
        String receiverGroupType,
        boolean read,
        Integer readCount,
        Integer totalCount,
        LocalDateTime createdAt
) {
}