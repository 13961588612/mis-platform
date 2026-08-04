package com.mis.adminbff.dto.kb;

/**
 * 工单时间线条目（BFF 侧镜像）。
 *
 * <p>{@code at} 是 ISO-8601 字符串而非 {@code Instant}：时间线整体以 JSON 文本存在
 * {@code kb_qa_ticket.time_line} 里，保持字符串可以避免「存进去是 Instant、
 * 读出来因序列化配置差异变成数字」这类跨服务反序列化事故。
 *
 * @param at     发生时间，ISO-8601
 * @param from   原状态；首条为 {@code null}
 * @param to     目标状态
 * @param userId 操作人
 * @param note   备注
 */
public record KbTicketTimelineEntry(
        String at,
        String from,
        String to,
        Long userId,
        String note) {
}
