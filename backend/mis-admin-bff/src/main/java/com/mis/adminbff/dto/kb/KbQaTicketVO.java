package com.mis.adminbff.dto.kb;

import java.time.Instant;
import java.util.List;

/**
 * 问答工单视图（F-10 / A-02c，BFF 侧镜像）。
 *
 * @param id         工单 id
 * @param sessionId  关联会话 id
 * @param messageId  关联消息 id；可空
 * @param type       工单类型码值
 * @param typeLabel  工单类型中文名（下游已翻译，前端直接展示）
 * @param status     状态码值 open/processing/resolved/closed
 * @param content    提单内容
 * @param note       处理备注
 * @param relAction  关联动作码值
 * @param creatorId  提单人
 * @param handlerId  首次受理人
 * @param processorId 最近处理人
 * @param timeline   状态流转时间线
 * @param createdAt  创建时间
 * @param updatedAt  更新时间
 */
public record KbQaTicketVO(
        Long id,
        Long sessionId,
        Long messageId,
        String type,
        String typeLabel,
        String status,
        String content,
        String note,
        String relAction,
        Long creatorId,
        Long handlerId,
        Long processorId,
        List<KbTicketTimelineEntry> timeline,
        Instant createdAt,
        Instant updatedAt) {
}
