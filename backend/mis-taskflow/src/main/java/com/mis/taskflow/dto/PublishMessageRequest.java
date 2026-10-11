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
 * @param appCode    可选应用归属（{@code sys_app.code}）；{@code null}/空白 = 平台级。
 *                   由 {@code MessageService.publish} **按显式值直取**（自身不推导）。
 *                   末尾追加，兼容既有 {@code new PublishMessageRequest(...)} 调用点。
 * @param bizType    可选业务类型（软引用 {@code biz_category.code}）；{@code null}/空白 = 未标注。
 *                   由 {@code MessageService.publish} 显式写入 {@code sys_message.biz_type}。
 *                   末尾追加，兼容既有调用点。
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
        Long instanceId,
        String appCode,
        String bizType
) {
}