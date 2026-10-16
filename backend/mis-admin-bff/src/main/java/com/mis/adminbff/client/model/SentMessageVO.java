package com.mis.adminbff.client.model;

import java.time.LocalDateTime;
import java.util.List;

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
