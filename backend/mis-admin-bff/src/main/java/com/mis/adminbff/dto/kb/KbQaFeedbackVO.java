package com.mis.adminbff.dto.kb;

import java.time.Instant;

/**
 * 问答反馈视图（BFF 侧镜像）。
 *
 * <p>V43 起增反馈处理状态五字段，与 mis-kb {@code KbQaFeedbackVO} 严格同名
 * （Jackson 反序列化按字段名匹配，名字不一致会静默填 null）。
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
