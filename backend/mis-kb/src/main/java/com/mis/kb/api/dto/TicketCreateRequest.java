package com.mis.kb.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 建工单请求（F-10 问答一键报错）。
 *
 * @param sessionId 关联会话 id（必填，用于运营回溯上下文）
 * @param messageId 关联消息 id（可空：整段会话报错时不指定具体消息）
 * @param type      工单类型码值，见 {@link com.mis.kb.domain.model.TicketType}
 * @param content   问题描述
 */
public record TicketCreateRequest(
        @NotNull Long sessionId,
        Long messageId,
        @NotBlank String type,
        @NotBlank @Size(max = 2000) String content) {
}
