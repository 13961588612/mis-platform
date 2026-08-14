package com.mis.kb.api.dto;

import java.time.Instant;

/**
 * 问答反馈视图（详情 / 反馈列表共用）。
 *
 * <p>V43 起增反馈处理状态五字段：{@code feedbackStatus}（pending/handled/ignored）、
 * 处理人、处理时间、处理备注 —— 与实体 {@code KbQaFeedback} 一一对应。
 */
public record KbQaFeedbackVO(
        Long id,
        Long sessionId,
        Integer accuracy,
        Integer helpful,
        Integer offtopic,
        Integer citeError,
        String feedbackStatus,
        Long handlerId,
        String handlerName,
        Instant handledAt,
        String handleNote) {
}
