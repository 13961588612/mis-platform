package com.mis.adminbff.dto.kb;

import java.time.Instant;

/** 问答会话视图（BFF 侧镜像）。 */
public record KbQaSessionVO(
        Long id,
        Long userId,
        Long appId,
        Instant createdAt) {
}
