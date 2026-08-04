package com.mis.kb.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/** 问答消息创建请求。 */
public record QaMessageCreateRequest(
        @NotNull Long sessionId,
        @NotBlank String role,
        @NotBlank String content) {
}
