package com.mis.adminbff.dto.kb;

import java.time.Instant;

/**
 * 问答会话视图（BFF 侧镜像）。
 *
 * @param title 会话标题；为 {@code null} 时前端兜底展示「会话 #id」（不暴露软删字段）
 */
public record KbQaSessionVO(
        Long id,
        Long userId,
        Long appId,
        Instant createdAt,
        String title) {
}
