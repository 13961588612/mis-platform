package com.mis.kb.api.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

import java.util.List;

/** 问答引用批量落库请求（由 mis-rag 经内部 API 调用）。 */
public record QaCitationBatchRequest(
        @NotNull Long messageId,
        @Valid List<QaCitationItem> citations) {
}
