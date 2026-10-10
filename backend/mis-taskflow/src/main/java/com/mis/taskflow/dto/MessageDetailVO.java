package com.mis.taskflow.dto;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 消息详情（含内容与附件）。
 *
 * @param instanceId 关联流程实例 ID（无关联时为 {@code null}）
 * @param canReply   是否可回复（{@code msgType=='NOTIFY' && instanceId!=null}）
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
        LocalDateTime createdAt,
        String instanceId,
        boolean canReply
) {
}