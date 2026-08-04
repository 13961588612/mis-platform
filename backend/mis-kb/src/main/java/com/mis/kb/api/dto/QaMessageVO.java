package com.mis.kb.api.dto;

import java.time.Instant;
import java.util.List;

/** 问答消息视图（含其引用）。 */
public record QaMessageVO(
        Long id,
        String role,
        String content,
        Instant createdAt,
        List<QaCitationVO> citations) {
}
