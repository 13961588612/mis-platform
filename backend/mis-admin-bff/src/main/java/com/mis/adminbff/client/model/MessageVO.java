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
        boolean canReply,
        String appCode,
        // 末尾追加：业务类型（软引用 biz_category.code）；null = 未标注。
        // 必须与下游 mis-taskflow MessageVO 同名透传，否则 Jackson 反序列化时被静默丢弃，
        // 门户消息表「业务类型」列将恒为空。
        String bizType
) {
}