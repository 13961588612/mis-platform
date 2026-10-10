package com.mis.adminbff.client.model;

import java.time.LocalDateTime;

/** 消息视图（BFF 透传 mis-taskflow）。 */
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
        LocalDateTime createdAt,
        String instanceId,
        boolean canReply
) {
}