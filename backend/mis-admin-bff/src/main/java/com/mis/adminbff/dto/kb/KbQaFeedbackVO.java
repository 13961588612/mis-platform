package com.mis.adminbff.dto.kb;

/** 问答反馈视图（BFF 侧镜像）。 */
public record KbQaFeedbackVO(
        Long id,
        Long sessionId,
        Integer accuracy,
        Integer helpful,
        Integer offtopic,
        Integer citeError) {
}
