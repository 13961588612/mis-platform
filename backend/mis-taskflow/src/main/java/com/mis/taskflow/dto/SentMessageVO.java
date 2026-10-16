package com.mis.taskflow.dto;

import java.time.LocalDateTime;
import java.util.List;

/** 后台发送记录列表行。 */
public record SentMessageVO(
        String id,
        String title,
        String summary,
        String senderName,
        String audience,
        int readCount,
        int totalCount,
        LocalDateTime createdAt
) {
}
