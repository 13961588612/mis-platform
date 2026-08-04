package com.mis.adminbff.dto.kb;

import java.util.List;

/**
 * 评价看板视图（A-02b/d，BFF 侧镜像）。
 *
 * <p><b>字段名与 mis-kb {@code com.mis.kb.api.dto.KbDashboardVO} 严格同名</b>：
 * {@link com.mis.adminbff.client.KbWebClient} 用 Jackson 把 mis-kb 返回的 JSON 直接反序列化进本 record，
 * 名字一旦不一致 Jackson 不会报错、只会把对不上的字段填 {@code null}。因此本类只是镜像，
 * 不增删字段、不改名。好评/差评分档口径见 mis-kb 侧 VO 注释（表无点赞点踩字段，按评分折算）。
 *
 * @param sessionCount         会话总数
 * @param messageCount         消息总数
 * @param feedbackCount        反馈总数
 * @param feedbackRate         反馈率（0~1，两位小数）
 * @param avgAccuracy          平均准确性评分；无反馈为 {@code null}
 * @param avgHelpful           平均有用性评分；无反馈为 {@code null}
 * @param offtopicCount        跑题标记数
 * @param citeErrorCount       引用错误标记数
 * @param openTickets          未关闭工单数
 * @param totalTickets         工单总数
 * @param ratedCount           参与好评/差评判定的反馈数
 * @param positiveCount        好评数（score &gt;= 4）
 * @param negativeCount        差评数（score &lt;= 2）
 * @param positiveRate         好评率（0~1，两位小数）；无评分为 {@code null}
 * @param avgScore             综合平均分（0~5，两位小数）；无评分为 {@code null}
 * @param negativeDimensions   差评维度分布（固定四桶）
 * @param topNegativeQuestions 高频差评问 Top N
 * @param lowScoreLibraries    低分知识库 TopN（按均分升序）
 * @param lowScoreDocuments    低分文档 TopN（按均分升序）
 * @param trend                按日趋势
 * @param topLibraries         命中 Top 知识库
 */
public record KbDashboardVO(
        Long sessionCount,
        Long messageCount,
        Long feedbackCount,
        Double feedbackRate,
        Double avgAccuracy,
        Double avgHelpful,
        Long offtopicCount,
        Long citeErrorCount,
        Long openTickets,
        Long totalTickets,
        Long ratedCount,
        Long positiveCount,
        Long negativeCount,
        Double positiveRate,
        Double avgScore,
        List<DimensionCount> negativeDimensions,
        List<QuestionCount> topNegativeQuestions,
        List<LibraryScore> lowScoreLibraries,
        List<DocumentScore> lowScoreDocuments,
        List<DailyPoint> trend,
        List<LibraryHit> topLibraries) {

    /**
     * 单日统计点。
     *
     * @param date          日期 yyyy-MM-dd（UTC）
     * @param sessionCount  当日会话数
     * @param feedbackCount 当日反馈数
     * @param avgScore      当日综合平均分；当日无评分为 {@code null}
     */
    public record DailyPoint(String date, Long sessionCount, Long feedbackCount, Double avgScore) {
    }

    /**
     * 知识库命中统计。
     *
     * @param libraryId   知识库 id
     * @param libraryName 知识库名称
     * @param hitCount    命中次数
     */
    public record LibraryHit(Long libraryId, String libraryName, Long hitCount) {
    }

    /**
     * 差评维度计数（图1）。
     *
     * @param code  维度码值（low_accuracy / low_helpful / offtopic / cite_error）
     * @param label 维度中文名
     * @param count 命中条数
     */
    public record DimensionCount(String code, String label, Long count) {
    }

    /**
     * 高频差评问（图2）。
     *
     * @param question  提问文本
     * @param count     出现次数
     * @param sessionId 代表性会话 id
     */
    public record QuestionCount(String question, Long count, Long sessionId) {
    }

    /**
     * 低分知识库（图3）。
     *
     * @param libraryId   知识库 id
     * @param libraryName 知识库名称
     * @param avgScore    平均分（0~5，两位小数）
     * @param ratedCount  参与计算的评价数
     */
    public record LibraryScore(Long libraryId, String libraryName, Double avgScore, Long ratedCount) {
    }

    /**
     * 低分文档（图3）。
     *
     * @param documentId 文档 id
     * @param libraryId  所属知识库 id
     * @param title      文档标题
     * @param avgScore   平均分（0~5，两位小数）
     * @param ratedCount 参与计算的评价数
     */
    public record DocumentScore(
            Long documentId, Long libraryId, String title, Double avgScore, Long ratedCount) {
    }
}
