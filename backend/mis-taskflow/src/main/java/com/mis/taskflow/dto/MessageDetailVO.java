package com.mis.taskflow.dto;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 消息详情（含内容与附件）。
 */
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
        LocalDateTime createdAt
) {
}