package com.mis.kb.api.dto;

import java.time.Instant;

/** 问答会话视图（列表用）。 */
public record KbQaSessionVO(
        Long id,
        Long userId,
        Long appId,
        Instant createdAt) {
}
