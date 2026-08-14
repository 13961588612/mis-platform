package com.mis.adminbff.dto.kb;

import java.time.Instant;
import java.util.List;

/**
 * 运营问答列表行（A-02b，BFF 侧镜像）。
 *
 * @param id             会话 id
 * @param userId         提问用户 id
 * @param userName       提问用户名（BFF 回填；查不到保持 {@code null}）
 * @param appId          应用 id
 * @param createdAt      创建时间
 * @param question       首个提问（已截断）
 * @param answerBrief    首个回答摘要（已截断）
 * @param messageCount   消息条数
 * @param citeCount      引用条数
 * @param libraryIds     命中知识库 id 列表
 * @param hasFeedback    是否已反馈
 * @param accuracy       准确性评分；未反馈为 {@code null}
 * @param helpful        有用性评分；未反馈为 {@code null}
 * @param offtopic       跑题评分；未反馈为 {@code null}
 * @param citeError      引用错误评分；未反馈为 {@code null}
 * @param sentiment      评价结果：positive 好评 / negative 差评 / null 未反馈或未判定
 * @param feedbackStatus 反馈处理状态：pending/handled/ignored；未反馈为 {@code null}
 * @param ticketStatus   该会话最新工单状态；无工单为 {@code null}
 */
public record KbQaSessionListVO(
        Long id,
        Long userId,
        String userName,
        Long appId,
        Instant createdAt,
        String question,
        String answerBrief,
        Integer messageCount,
        Integer citeCount,
        List<Long> libraryIds,
        Boolean hasFeedback,
        Integer accuracy,
        Integer helpful,
        Integer offtopic,
        Integer citeError,
        String sentiment,
        String feedbackStatus,
        String ticketStatus) {
}
