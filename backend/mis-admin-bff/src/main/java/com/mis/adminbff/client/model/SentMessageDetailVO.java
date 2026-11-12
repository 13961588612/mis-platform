package com.mis.adminbff.client.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.LocalDateTime;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public record SentMessageDetailVO(
        String id,
        String title,
        String summary,
        String content,
        String attachments,
        String audience,
        String senderName,
        int readCount,
        int totalCount,
        boolean receiversTruncated,
        List<ReceiverReadVO> receivers,
        LocalDateTime createdAt
) {
    public record ReceiverReadVO(String userId, String name, boolean read) {
    }
}
