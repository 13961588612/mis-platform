package com.mis.kb.api.dto;

import java.time.Instant;
import java.util.List;

/**
 * 工单视图（A-02c）。
 *
 * @param id          工单 id
 * @param sessionId   关联会话 id
 * @param messageId   关联消息 id
 * @param type        工单类型码值
 * @param typeLabel   工单类型中文名（后端直出，前端无需再维护映射，规避 X-01 类字典漂移）
 * @param status      状态码值
 * @param content     问题描述
 * @param note        处理备注
 * @param relAction   关联动作码值
 * @param creatorId   提单人
 * @param handlerId   受理人
 * @param processorId 当前处理人
 * @param timeline    状态流转时间线
 * @param createdAt   创建时间
 * @param updatedAt   更新时间
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
