package com.mis.kb.api.dto;

/** 问答反馈视图。 */
public record KbQaFeedbackVO(
        Long id,
        Long sessionId,
        Integer accuracy,
        Integer helpful,
        Integer offtopic,
        Integer citeError) {
}
