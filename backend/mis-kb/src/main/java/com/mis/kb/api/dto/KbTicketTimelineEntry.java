package com.mis.kb.api.dto;

/**
 * 工单时间线条目（序列化为 {@code kb_qa_ticket.time_line} 的 JSON 数组元素）。
 *
 * <p>时间用 ISO-8601 字符串而非 {@code Instant}：该结构会被整体序列化进 TEXT 列，
 * 用字符串可避免 Jackson 模块配置差异（如未注册 JavaTimeModule）导致的写入失败，
 * 也便于人工直接阅读库里的原始 JSON。
 *
 * @param at     发生时间（ISO-8601，UTC）
 * @param from   原状态码值；创建时为 {@code null}
 * @param to     新状态码值
 * @param userId 操作人
 * @param note   操作备注
 */
public record KbTicketTimelineEntry(
        String at,
        String from,
        String to,
        Long userId,
        String note) {
}
