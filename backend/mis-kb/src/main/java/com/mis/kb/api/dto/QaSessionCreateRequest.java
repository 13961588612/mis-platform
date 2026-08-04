package com.mis.kb.api.dto;

import jakarta.validation.constraints.NotNull;

/** 问答会话创建请求（由 mis-rag 经内部 API 调用）。 */
public record QaSessionCreateRequest(@NotNull Long userId, Long appId) {
}
