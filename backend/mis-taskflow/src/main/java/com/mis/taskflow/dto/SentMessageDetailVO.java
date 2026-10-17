package com.mis.taskflow.dto;

import java.time.LocalDateTime;
import java.util.List;

/** 发送记录详情，含接收人已读。 */
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
    public record ReceiverReadVO(String userId, boolean read) {
    }
}
