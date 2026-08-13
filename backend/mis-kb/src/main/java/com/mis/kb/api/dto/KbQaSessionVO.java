package com.mis.kb.api.dto;

import java.time.Instant;

/**
 * 问答会话视图（列表用）。
 *
 * @param title 会话标题；为 {@code null} 时前端兜底展示「会话 #id」（不暴露软删字段 deletedAt）
 */
public record KbQaSessionVO(
        Long id,
        Long userId,
        Long appId,
        Instant createdAt,
        String title) {
}
