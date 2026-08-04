package com.mis.kb.api.dto;

/**
 * 运营记录导出行（A-02e）。
 *
 * <p>mis-kb 只负责产出结构化行数据；<b>CSV 拼装与脱敏在 BFF 的 {@code KbExportService} 完成</b>，
 * 因为「是否带身份」属于展示层策略，且 BFF 才持有当前操作人的权限上下文。
 *
 * @param sessionId  会话 id
 * @param userId     提问用户 id（BFF 侧按 {@code withIdentity} 决定是否哈希脱敏）
 * @param createdAt  会话创建时间（ISO-8601）
 * @param question   首个用户提问
 * @param answer     首个助手回答
 * @param libraryIds 命中知识库 id（逗号分隔）
 * @param citeCount  引用条数
 * @param accuracy   准确性评分；无反馈为 {@code null}
 * @param helpful    有用性评分；无反馈为 {@code null}
 * @param offtopic   跑题评分；无反馈为 {@code null}
 * @param citeError  引用错误评分；无反馈为 {@code null}
 */
public record KbQaExportRow(
        Long sessionId,
        Long userId,
        String createdAt,
        String question,
        String answer,
        String libraryIds,
        int citeCount,
        Integer accuracy,
        Integer helpful,
        Integer offtopic,
        Integer citeError) {
}
