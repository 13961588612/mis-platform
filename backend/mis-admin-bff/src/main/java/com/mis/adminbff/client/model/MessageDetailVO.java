package com.mis.adminbff.client.model;

import java.time.LocalDateTime;
import java.util.List;

/** 消息详情（BFF 透传 mis-taskflow）。 */
public record MessageDetailVO(
        String id,
        String msgType,
        String category,
        String title,
        String summary,
        String content,
        String attachments,
        String senderId,
        String senderName,
        String referenceTaskId,
        boolean read,
        List<String> receiverUserIds,
        LocalDateTime createdAt,
        String instanceId,
        boolean canReply
) {
}