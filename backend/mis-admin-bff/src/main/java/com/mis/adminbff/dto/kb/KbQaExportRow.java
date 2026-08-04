package com.mis.adminbff.dto.kb;

/**
 * 导出行（A-02e，BFF 侧镜像）。
 *
 * <p>{@code userId} 在 BFF 导出时默认被替换为脱敏哈希，不落明文；
 * 需要明文时由调用方显式传 {@code desensitize=false} 并承担审计责任。
 *
 * @param sessionId    会话 id
 * @param userId       提问用户 id（导出时会被脱敏）
 * @param createdAt    创建时间，ISO-8601 字符串
 * @param question     提问
 * @param answerBrief  回答摘要
 * @param libraryIds   命中知识库 id，逗号分隔
 * @param citeCount    引用条数
 * @param accuracy     准确性评分
 * @param helpful      有用性评分
 * @param ticketStatus 关联工单状态；当前版本恒为 {@code null}
 * @param note         备注；当前版本恒为 {@code null}
 */
public record KbQaExportRow(
        Long sessionId,
        Long userId,
        String createdAt,
        String question,
        String answerBrief,
        String libraryIds,
        Integer citeCount,
        Integer accuracy,
        Integer helpful,
        String ticketStatus,
        String note) {
}
