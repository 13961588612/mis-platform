package com.mis.kb.api.dto;

import java.util.List;

/**
 * 运营评价看板（A-02b / A-02d）。
 *
 * <p><b>字段名与 BFF {@code com.mis.adminbff.dto.kb.KbDashboardVO} 严格同名</b>：
 * BFF 侧直接把本 VO 的 JSON 反序列化进它自己的 record，字段名一旦不一致，
 * Jackson 不会报错、只会把对不上的字段填 null，前端看到的是「有接口、全空值」的假故障。
 * 因此 {@code sessionCount}/{@code messageCount}/{@code trend} 这三个名字是契约，不要按
 * 「total 开头更语义化」之类的理由重命名。
 *
 * <p><b>好评/差评口径（重要，与需求原文有偏离）：</b>需求描述的是
 * {@code thumbsUp/(thumbsUp+thumbsDown)}，但 {@code kb_qa_feedback} 表**没有点赞点踩字段**
 * （只有 accuracy/helpful/offtopic/citeError 四个 0-5 分维度），本轮又明确不新增迁移。
 * 故按评分折算：
 * <ul>
 *   <li>{@code score} = accuracy 与 helpful 中**非空项的均值**（两者皆空视为未评分，不计入分母）</li>
 *   <li>好评：{@code score >= 4}；差评：{@code score <= 2}；其余为中评</li>
 *   <li>{@code positiveRate = positiveCount / ratedCount}（分母含中评）</li>
 * </ul>
 * 三个计数（{@code ratedCount}/{@code positiveCount}/{@code negativeCount}）全部透出，
 * 消费方若想改用「好评/(好评+差评)」口径可自行换算，无需改后端。
 *
 * @param sessionCount         区间内会话总数
 * @param messageCount         区间内消息总数
 * @param feedbackCount        已反馈会话数
 * @param feedbackRate         反馈率（0~1，两位小数）
 * @param avgAccuracy          平均准确性评分；无数据为 {@code null}
 * @param avgHelpful           平均有用性评分；无数据为 {@code null}
 * @param offtopicCount        跑题标记数（offtopic &gt; 0 的反馈条数）
 * @param citeErrorCount       引用错误标记数（citeError &gt; 0 的反馈条数）
 * @param openTickets          未关闭工单数
 * @param totalTickets         工单总数
 * @param pendingFeedback      待处理反馈数（feedback_status='pending' 的反馈条数）
 * @param ratedCount           参与好评/差评判定的反馈数（accuracy 或 helpful 至少一项非空）
 * @param positiveCount        好评数（score &gt;= 4）
 * @param negativeCount        差评数（综合分 &lt;= 2 或 offtopic&gt;0 或 citeError&gt;0，
 *                             与运营列表/导出的 sentiment=negative 口径同源）
 * @param positiveRate         好评率（0~1，两位小数）；{@code ratedCount == 0} 时为 {@code null}
 * @param avgScore             综合平均分（0~5，两位小数）；无评分为 {@code null}
 * @param negativeDimensions   差评维度分布（固定四桶，计数可为 0）
 * @param topNegativeQuestions 高频差评问 Top N
 * @param lowScoreLibraries    低分知识库 TopN（按均分升序）
 * @param lowScoreDocuments    低分文档 TopN（按均分升序）
 * @param trend                按日趋势
 * @param topLibraries         命中次数 Top 知识库
 */
public record KbDashboardVO(
        long sessionCount,
        long messageCount,
        long feedbackCount,
        double feedbackRate,
        Double avgAccuracy,
        Double avgHelpful,
        long offtopicCount,
        long citeErrorCount,
        long openTickets,
        long totalTickets,
        long pendingFeedback,
        long ratedCount,
        long positiveCount,
        long negativeCount,
        Double positiveRate,
        Double avgScore,
        List<DimensionCount> negativeDimensions,
        List<QuestionCount> topNegativeQuestions,
        List<LibraryScore> lowScoreLibraries,
        List<DocumentScore> lowScoreDocuments,
        List<DailyPoint> trend,
        List<LibraryHit> topLibraries) {

    /**
     * 按日统计点。
     *
     * @param date          日期（yyyy-MM-dd，UTC）
     * @param sessionCount  当日会话数
     * @param feedbackCount 当日反馈数
     * @param avgScore      当日综合平均分；当日无评分为 {@code null}（不要用 0 兜底，0 分是合法评价）
     */
    public record DailyPoint(String date, long sessionCount, long feedbackCount, Double avgScore) {
    }

    /**
     * 知识库命中统计。
     *
     * @param libraryId   知识库 id
     * @param libraryName 知识库名；未解析到为 {@code null}
     * @param hitCount    被引用次数
     */
    public record LibraryHit(Long libraryId, String libraryName, long hitCount) {
    }

    /**
     * 差评维度计数（A-02b 图1）。
     *
     * <p>一条反馈可同时命中多个维度（如既跑题又引用错误），因此各桶计数之和
     * <b>不等于</b> {@code negativeCount}，这是多选维度分布的正常形态，不是统计口径 bug。
     *
     * @param code  维度码值（low_accuracy / low_helpful / offtopic / cite_error）
     * @param label 维度中文名（后端给全，前端不做码值翻译，避免两处字典漂移）
     * @param count 命中条数
     */
    public record DimensionCount(String code, String label, long count) {
    }

    /**
     * 高频差评问（A-02b 图2）。
     *
     * @param question  提问文本（同文本归并后的代表值，已折叠空白）
     * @param count     出现次数
     * @param sessionId 代表性会话 id（供运营下钻；同文本多会话时取最近一条）
     */
    public record QuestionCount(String question, long count, Long sessionId) {
    }

    /**
     * 低分知识库（A-02b 图3）。
     *
     * <p>归因口径：会话评分按「该会话引用到的每个知识库」<b>各计一次</b>。
     * 一次问答命中多库时，同一分数会同时计入多个库——这是无法避免的近似
     * （反馈是会话级的，无法拆到库级），用于横向比较趋势，不宜当作精确的单库质量分。
     *
     * @param libraryId   知识库 id
     * @param libraryName 知识库名；未解析到为 {@code null}
     * @param avgScore    平均分（0~5，两位小数）
     * @param ratedCount  参与计算的评价数
     */
    public record LibraryScore(Long libraryId, String libraryName, Double avgScore, long ratedCount) {
    }

    /**
     * 低分文档（A-02b 图3）。
     *
     * <p>归因口径同 {@link LibraryScore}，按引用到的文档逐个计入。
     *
     * @param documentId 文档 id
     * @param libraryId  所属知识库 id；引用未记录时为 {@code null}
     * @param title      文档标题；未解析到为 {@code null}
     * @param avgScore   平均分（0~5，两位小数）
     * @param ratedCount 参与计算的评价数
     */
    public record DocumentScore(
            Long documentId, Long libraryId, String title, Double avgScore, long ratedCount) {
    }

    /** 空看板（区间内无数据时返回，避免前端判空分支）。 */
    public static KbDashboardVO empty() {
        return new KbDashboardVO(
                0L, 0L, 0L, 0.0D, null, null, 0L, 0L, 0L, 0L, 0L,
                0L, 0L, 0L, null, null,
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
    }
}
