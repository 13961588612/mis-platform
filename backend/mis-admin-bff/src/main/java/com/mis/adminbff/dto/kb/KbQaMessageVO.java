package com.mis.adminbff.dto.kb;

import java.time.Instant;
import java.util.List;

/** 问答消息视图（BFF 侧镜像，含引用）。 */
public record KbQaMessageVO(
        Long id,
        String role,
        String content,
        Instant createdAt,
        List<KbQaCitationVO> citations) {
}
