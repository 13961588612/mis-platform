package com.mis.kb.api.dto;

import java.time.Instant;
import java.util.List;

/**
 * 运营问答列表行（A-02b）。
 *
 * <p>在 {@link KbQaSessionVO} 基础上补充列表页直接需要的摘要字段，
 * 避免前端为每行再发一次详情请求。
 *
 * @param id           会话 id
 * @param userId       提问用户 id
 * @param appId        来源应用 id
 * @param createdAt    创建时间
 * @param question     首个用户提问（截断至 200 字）
 * @param answerBrief  首个助手回答摘要（截断至 200 字）
 * @param messageCount 消息条数
 * @param citeCount    引用条数
 * @param libraryIds   命中知识库 id 列表
 * @param hasFeedback  是否已提交反馈
 * @param accuracy     准确性评分；无反馈为 {@code null}
 * @param helpful      有用性评分；无反馈为 {@code null}
 */
public record KbQaSessionListVO(
        Long id,
        Long userId,
        Long appId,
        Instant createdAt,
        String question,
        String answerBrief,
        int messageCount,
        int citeCount,
        List<Long> libraryIds,
        boolean hasFeedback,
        Integer accuracy,
        Integer helpful) {
}
