package com.mis.kb.api.dto;

import jakarta.validation.constraints.NotNull;

/** 问答反馈提交请求（前端 → BFF → mis-kb）。 */
public record QaFeedbackRequest(
        @NotNull Long sessionId,
        Integer accuracy,
        Integer helpful,
        Integer offtopic,
        Integer citeError) {
}
