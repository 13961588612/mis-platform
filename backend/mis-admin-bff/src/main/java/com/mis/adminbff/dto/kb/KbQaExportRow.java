package com.mis.adminbff.dto.kb;

/**
 * 导出行（A-02e，BFF 侧镜像）。
 *
 * <p>{@code userId} 在 BFF 导出时默认被替换为脱敏哈希，不落明文；
 * 需要明文时由调用方显式传 {@code desensitize=false} 并承担审计责任。
 *
 * <p><b>字段必须与 mis-kb {@code KbQaExportRow} 严格同名</b>：BFF 直接把下游 JSON
 * 反序列化进本 record，名字不一致 Jackson 不会报错、只会填 null。
 * 历史版本末两列误写为 {@code ticketStatus}/{@code note}（下游实际发的是
 * {@code offtopic}/{@code citeError}），V43 起修正为与下游一致。
 *
 * @param sessionId   会话 id
 * @param userId      提问用户 id（导出时会被脱敏）
 * @param createdAt   创建时间，ISO-8601 字符串
 * @param question    提问
 * @param answer      回答摘要
 * @param libraryIds  命中知识库 id，逗号分隔
 * @param citeCount   引用条数
 * @param accuracy    准确性评分
 * @param helpful     有用性评分
 * @param offtopic    跑题评分；未反馈为 {@code null}
 * @param citeError   引用错误评分；未反馈为 {@code null}
 */
public record KbQaExportRow(
        Long sessionId,
        Long userId,
        String createdAt,
        String question,
        String answer,
        String libraryIds,
        Integer citeCount,
        Integer accuracy,
        Integer helpful,
        Integer offtopic,
        Integer citeError) {
}
