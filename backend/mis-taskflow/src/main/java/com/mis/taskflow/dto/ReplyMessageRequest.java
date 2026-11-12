package com.mis.taskflow.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 回复消息请求（PR-18）。
 *
 * <p>回复语义 = 回写为该消息所关联流程实例的一条审批意见（{@code wf_history} 追加
 * {@code operation=COMMENT} 记录），不改变流程状态、不推进节点。
 *
 * @param content 回复正文（必填）
 */
public record ReplyMessageRequest(
        @NotBlank String content
) {
}
