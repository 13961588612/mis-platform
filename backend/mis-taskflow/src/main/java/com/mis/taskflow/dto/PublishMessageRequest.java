package com.mis.taskflow.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;

/**
 * 发布消息请求（内部 API / 业务服务调用）。
 *
 * @param content 可选 JSON 字符串（富文本内容）
 */
public record PublishMessageRequest(
        @NotBlank String msgType,
        @NotBlank String category,
        @NotBlank String title,
        String summary,
        String content,
        String attachments,
        Long senderId,
        String senderName,
        @NotEmpty List<Long> receiverIds,
        Long referenceTaskId
) {
}