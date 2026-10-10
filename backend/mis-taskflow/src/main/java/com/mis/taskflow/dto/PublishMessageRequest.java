package com.mis.taskflow.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;

/**
 * 发布消息请求（内部 API / 业务服务调用）。
 *
 * @param content    可选 JSON 字符串（富文本内容）
 * @param instanceId 可选关联流程实例 ID（{@code wf_instance.id}）；流程通知用于携带实例线索，
 *                   普通通知/代办通知传 {@code null}
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
        Long referenceTaskId,
        Long instanceId
) {
}