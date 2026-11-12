package com.mis.taskflow.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;

/**
 * 后台发送（接收人已由 BFF 按并集解析）。
 *
 * @param audience 圈人快照 JSON
 * @param contentHtml 富文本 HTML，服务端再清洗
 */
public record AdminSendRequest(
        @NotBlank String title,
        String summary,
        String contentHtml,
        List<Long> attachmentFileIds,
        @NotEmpty List<Long> receiverIds,
        @NotBlank String audience,
        Long senderId,
        String senderName
) {
}
