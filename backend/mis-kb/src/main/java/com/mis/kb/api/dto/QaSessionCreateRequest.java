package com.mis.kb.api.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 问答会话创建请求（由 mis-rag 经内部 API 调用）。
 *
 * @param title 会话标题（首问前 30 字符，mis-rag 侧截断）；可为 {@code null}
 */
public record QaSessionCreateRequest(@NotNull Long userId, Long appId, String title) {
}
