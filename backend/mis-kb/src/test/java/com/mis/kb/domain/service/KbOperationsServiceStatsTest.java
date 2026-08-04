package com.mis.kb.domain.service;

import com.mis.kb.api.dto.KbDashboardVO;
import com.mis.kb.domain.entity.KbDocument;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.entity.KbQaCitation;
import com.mis.kb.domain.entity.KbQaFeedback;
import com.mis.kb.domain.entity.KbQaMessage;
import com.mis.kb.domain.entity.KbQaSession;
import com.mis.kb.domain.model.QaRole;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.domain.repository.KbQaCitationRepository;
import com.mis.kb.domain.repository.KbQaFeedbackRepository;
import com.mis.kb.domain.repository.KbQaMessageRepository;
import com.mis.kb.domain.repository.KbQaSessionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * 评价看板聚合计算单测（T18 / A-02b 验收）。
 *
 * <p>只用 Mockito 假仓储喂入构造数据，**不启 Spring 容器、不连数据库**——本测试验证的是
 * {@link KbOperationsService#stats} 的纯内存聚合算术，与 JPA 映射层无关。
 * 换言之：本测试全绿 <b>不能</b> 证明派生查询属性名正确、也不能证明表结构对得上，
 * 那两层只有应用真实启动（连 dev 栈 PG）才会被 Hibernate 校验。
 *
 * <p>覆盖的聚合口径：
 * <ul>
 *   <li>基础计数：会话数 / 消息数 / 反馈数 / 反馈率</li>
 *   <li>好评率与综合均分（accuracy 与 helpful 非空项均值折算，好评 ≥4、差评 ≤2）</li>
 *   <li>差评维度分布固定四桶，且各桶之和可以 ≠ negativeCount（多选维度）</li>
 *   <li>高频差评问 Top10：同文本归并计数 + 代表会话取最近一条</li>
 *   <li>低分库 / 低分文档 TopN：按均分升序，一会话多库时同分计入多个桶</li>
 *   <li>按日趋势：会话数 / 反馈数 / 当日均分（当日无评分为 null，不用 0 兜底）</li>
 *   <li>边界：区间内零会话、区间内有会话但零反馈</li>
 * </ul>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class KbOperationsServiceStatsTest {

    @Mock
    private KbQaSessionRepository sessionRepository;
    @Mock
    private KbQaMessageRepository messageRepository;
    @Mock
    private KbQaCitationRepository citationRepository;
    @Mock
    private KbQaFeedbackRepository feedbackRepository;
    @Mock
    private KbLibraryRepository libraryRepository;
    @Mock
    private KbDocumentRepository documentRepository;
    @Mock
    private KbQaTicketService ticketService;

    private KbOperationsService operationsService;

    /** 2026-08-01 02:00Z —— 与 DAY_FORMATTER 的 UTC 口径对齐，落在 08-01 桶。 */
    private static final Instant DAY1_EARLY = Instant.parse("2026-08-01T02:00:00Z");
    /** 2026-08-01 05:00Z —— 同日第二条会话。 */
    private static final Instant DAY1_LATE = Instant.parse("2026-08-01T05:00:00Z");
    /** 2026-08-02 01:00Z —— 次日会话。 */
    private static final Instant DAY2 = Instant.parse("2026-08-02T01:00:00Z");

    @BeforeEach
    void setUp() {
        operationsService = new KbOperationsService(
                sessionRepository,
                messageRepository,
                citationRepository,
                feedbackRepository,
                libraryRepository,
                documentRepository,
                ticketService);
        when(ticketService.countOpen()).thenReturn(4L);
        when(ticketService.countAll()).thenReturn(9L);
    }

    // ------------------------------------------------------------------ 主用例

    /**
     * 完整数据集下的全指标断言。
     *
     * <p>数据集（会话按 id 倒序返回，与 {@code findByCreatedAtBetweenOrderByIdDesc} 语义一致）：
     * <pre>
     * s3(08-02) 问「年假怎么算？」 反馈 acc=5 help=5 offtopic=1 → 综合 5.0 好评，但被标跑题
     * s2(08-01) 问「如何报销差旅？」反馈 acc=2 help=2          → 综合 2.0 差评
     * s1(08-01) 问「如何报销差旅？」反馈 acc=1 help=1          → 综合 1.0 差评
     * 引用：s1→lib7(doc70,doc71)  s2→lib7(doc70)+lib8(doc80)  s3→lib8(doc80)
     * </pre>
     */
    @Test
    void stats_aggregatesAllMetrics() {
        stubFullDataset();

        KbDashboardVO vo = operationsService.stats(DAY1_EARLY, DAY2);

        // --- 基础计数
        assertEquals(3L, vo.sessionCount());
        assertEquals(6L, vo.messageCount());
        assertEquals(3L, vo.feedbackCount());
        assertEquals(1.0D, vo.feedbackRate());
        assertEquals(4L, vo.openTickets());
        assertEquals(9L, vo.totalTickets());

        // --- 均分：(1+2+5)/3 = 2.6667 → 两位小数 2.67
        assertEquals(Double.valueOf(2.67D), vo.avgAccuracy());
        assertEquals(Double.valueOf(2.67D), vo.avgHelpful());

        // --- 好评率：好评 1（5.0）/ 差评 2（1.0、2.0）/ 参评 3
        assertEquals(3L, vo.ratedCount());
        assertEquals(1L, vo.positiveCount());
        assertEquals(2L, vo.negativeCount());
        assertEquals(Double.valueOf(0.33D), vo.positiveRate());
        assertEquals(Double.valueOf(2.67D), vo.avgScore());

        // --- 显式标记计数
        assertEquals(1L, vo.offtopicCount());
        assertEquals(0L, vo.citeErrorCount());

        // --- 差评维度分布：固定四桶、固定顺序，后端已给中文 label
        List<KbDashboardVO.DimensionCount> dims = vo.negativeDimensions();
        assertEquals(4, dims.size());
        assertEquals("low_accuracy", dims.get(0).code());
        assertEquals("准确性不足", dims.get(0).label());
        assertEquals(2L, dims.get(0).count());
        assertEquals("low_helpful", dims.get(1).code());
        assertEquals(2L, dims.get(1).count());
        assertEquals("offtopic", dims.get(2).code());
        assertEquals(1L, dims.get(2).count());
        assertEquals("cite_error", dims.get(3).code());
        assertEquals(0L, dims.get(3).count());
        // 四桶之和 5 ≠ negativeCount 2：多选维度分布的正常形态，不是口径 bug
        long dimSum = dims.stream().mapToLong(KbDashboardVO.DimensionCount::count).sum();
        assertEquals(5L, dimSum);
        assertTrue(dimSum != vo.negativeCount());

        // --- 高频差评问：同文本归并计 2 次排首位；s3 虽是好评但被标跑题，也计入差评问
        List<KbDashboardVO.QuestionCount> questions = vo.topNegativeQuestions();
        assertEquals(2, questions.size());
        assertEquals("如何报销差旅？", questions.get(0).question());
        assertEquals(2L, questions.get(0).count());
        // 代表会话取「最近一条」= id 更大的 s2，而不是最早的 s1
        assertEquals(Long.valueOf(2L), questions.get(0).sessionId());
        assertEquals("年假怎么算？", questions.get(1).question());
        assertEquals(1L, questions.get(1).count());
        assertEquals(Long.valueOf(3L), questions.get(1).sessionId());

        // --- 热门库：lib7 被引 3 次、lib8 被引 2 次（按引用条数计，不去重）
        List<KbDashboardVO.LibraryHit> hits = vo.topLibraries();
        assertEquals(2, hits.size());
        assertEquals(Long.valueOf(7L), hits.get(0).libraryId());
        assertEquals("制度库", hits.get(0).libraryName());
        assertEquals(3L, hits.get(0).hitCount());
        assertEquals(Long.valueOf(8L), hits.get(1).libraryId());
        assertEquals(2L, hits.get(1).hitCount());

        // --- 低分库：lib7=(1.0+2.0)/2=1.5，lib8=(2.0+5.0)/2=3.5，升序
        List<KbDashboardVO.LibraryScore> lowLibs = vo.lowScoreLibraries();
        assertEquals(2, lowLibs.size());
        assertEquals(Long.valueOf(7L), lowLibs.get(0).libraryId());
        assertEquals(Double.valueOf(1.5D), lowLibs.get(0).avgScore());
        assertEquals(2L, lowLibs.get(0).ratedCount());
        assertEquals(Long.valueOf(8L), lowLibs.get(1).libraryId());
        assertEquals(Double.valueOf(3.5D), lowLibs.get(1).avgScore());

        // --- 低分文档：doc71=1.0，doc70=(1.0+2.0)/2=1.5，doc80=(2.0+5.0)/2=3.5，升序
        List<KbDashboardVO.DocumentScore> lowDocs = vo.lowScoreDocuments();
        assertEquals(3, lowDocs.size());
        assertEquals(Long.valueOf(71L), lowDocs.get(0).documentId());
        assertEquals(Double.valueOf(1.0D), lowDocs.get(0).avgScore());
        assertEquals(Long.valueOf(7L), lowDocs.get(0).libraryId());
        assertEquals("差旅附件", lowDocs.get(0).title());
        assertEquals(Long.valueOf(70L), lowDocs.get(1).documentId());
        assertEquals(Double.valueOf(1.5D), lowDocs.get(1).avgScore());
        assertEquals(2L, lowDocs.get(1).ratedCount());
        assertEquals(Long.valueOf(80L), lowDocs.get(2).documentId());
        assertEquals(Double.valueOf(3.5D), lowDocs.get(2).avgScore());

        // --- 按日趋势：升序排列，当日均分按当日会话的综合分平均
        List<KbDashboardVO.DailyPoint> trend = vo.trend();
        assertEquals(2, trend.size());
        assertEquals("2026-08-01", trend.get(0).date());
        assertEquals(2L, trend.get(0).sessionCount());
        assertEquals(2L, trend.get(0).feedbackCount());
        assertEquals(Double.valueOf(1.5D), trend.get(0).avgScore());
        assertEquals("2026-08-02", trend.get(1).date());
        assertEquals(1L, trend.get(1).sessionCount());
        assertEquals(1L, trend.get(1).feedbackCount());
        assertEquals(Double.valueOf(5.0D), trend.get(1).avgScore());
    }

    // ------------------------------------------------------------------ 边界用例

    /** 区间内零会话：全部指标归零，但工单计数仍要返回（工单不受时间区间约束）。 */
    @Test
    void stats_emptyRange_returnsZeroMetricsButKeepsTicketCounts() {
        when(sessionRepository.findByCreatedAtBetweenOrderByIdDesc(any(), any()))
                .thenReturn(List.of());

        KbDashboardVO vo = operationsService.stats(DAY1_EARLY, DAY2);

        assertEquals(0L, vo.sessionCount());
        assertEquals(0L, vo.messageCount());
        assertEquals(0L, vo.feedbackCount());
        assertEquals(0.0D, vo.feedbackRate());
        assertEquals(0L, vo.ratedCount());
        assertEquals(0L, vo.positiveCount());
        assertEquals(0L, vo.negativeCount());
        // 无数据时均分类指标必须是 null 而不是 0——0 分是合法评价，不能拿来兜底
        assertNull(vo.avgAccuracy());
        assertNull(vo.avgHelpful());
        assertNull(vo.positiveRate());
        assertNull(vo.avgScore());
        // 工单不随区间清零
        assertEquals(4L, vo.openTickets());
        assertEquals(9L, vo.totalTickets());
        // 四个差评维度桶依然齐全（前端图表不缺列）
        assertEquals(4, vo.negativeDimensions().size());
        assertTrue(vo.negativeDimensions().stream().allMatch(d -> d.count() == 0L));
        assertTrue(vo.topNegativeQuestions().isEmpty());
        assertTrue(vo.lowScoreLibraries().isEmpty());
        assertTrue(vo.lowScoreDocuments().isEmpty());
        assertTrue(vo.trend().isEmpty());
        assertTrue(vo.topLibraries().isEmpty());
    }

    /**
     * 有会话但零反馈：热门库命中统计仍要产出，低分归因与均分类指标为空。
     *
     * <p>这条专门盯住 {@code stats} 里「先累计命中、再 {@code if (score == null) continue}」
     * 的语句顺序：一旦有人把 continue 提前到引用遍历之前，未评分会话的命中就会被整段吞掉，
     * 表现为「有问答记录但热门知识库常年为空」。
     */
    @Test
    void stats_sessionsWithoutFeedback_stillCountsLibraryHits() {
        List<KbQaSession> sessions = List.of(session(1L, 10L, DAY1_EARLY));
        List<KbQaMessage> messages = List.of(
                message(101L, 1L, QaRole.USER.code(), "如何报销差旅？"),
                message(102L, 1L, QaRole.ASSISTANT.code(), "按《差旅管理办法》…"));
        when(sessionRepository.findByCreatedAtBetweenOrderByIdDesc(any(), any())).thenReturn(sessions);
        when(messageRepository.findBySessionIdInOrderBySessionIdAscIdAsc(any())).thenReturn(messages);
        when(feedbackRepository.findBySessionIdIn(any())).thenReturn(List.of());
        when(citationRepository.findByMessageIdIn(any()))
                .thenReturn(List.of(citation(1L, 102L, 7L, 70L)));
        when(libraryRepository.findAllById(any())).thenReturn(List.of(library(7L, "制度库")));
        when(documentRepository.findAllById(any())).thenReturn(List.of());

        KbDashboardVO vo = operationsService.stats(DAY1_EARLY, DAY2);

        assertEquals(1L, vo.sessionCount());
        assertEquals(2L, vo.messageCount());
        assertEquals(0L, vo.feedbackCount());
        assertEquals(0.0D, vo.feedbackRate());
        assertNull(vo.positiveRate());
        assertNull(vo.avgScore());
        // 命中统计不依赖反馈
        assertEquals(1, vo.topLibraries().size());
        assertEquals(Long.valueOf(7L), vo.topLibraries().get(0).libraryId());
        assertEquals(1L, vo.topLibraries().get(0).hitCount());
        // 低分归因需要评分，无反馈时应为空而不是塞 0 分
        assertTrue(vo.lowScoreLibraries().isEmpty());
        assertTrue(vo.lowScoreDocuments().isEmpty());
        // 趋势仍有当日会话数，但当日均分为 null
        assertEquals(1, vo.trend().size());
        assertEquals(1L, vo.trend().get(0).sessionCount());
        assertEquals(0L, vo.trend().get(0).feedbackCount());
        assertNull(vo.trend().get(0).avgScore());
    }

    /**
     * 文档已被删除时标题解析不到：{@code title} 留 null 交前端回落展示 #id，
     * 不允许后端编造「已删除文档」之类的假标题。
     */
    @Test
    void stats_deletedDocument_leavesTitleNull() {
        List<KbQaSession> sessions = List.of(session(1L, 10L, DAY1_EARLY));
        when(sessionRepository.findByCreatedAtBetweenOrderByIdDesc(any(), any())).thenReturn(sessions);
        when(messageRepository.findBySessionIdInOrderBySessionIdAscIdAsc(any())).thenReturn(List.of(
                message(101L, 1L, QaRole.USER.code(), "问题"),
                message(102L, 1L, QaRole.ASSISTANT.code(), "回答")));
        when(feedbackRepository.findBySessionIdIn(any()))
                .thenReturn(List.of(feedback(1L, 1, 1, null, null)));
        when(citationRepository.findByMessageIdIn(any()))
                .thenReturn(List.of(citation(1L, 102L, 7L, 999L)));
        when(libraryRepository.findAllById(any())).thenReturn(List.of(library(7L, "制度库")));
        // 文档 999 已被物理删除，findAllById 查不到
        when(documentRepository.findAllById(any())).thenReturn(List.of());

        KbDashboardVO vo = operationsService.stats(DAY1_EARLY, DAY2);

        assertEquals(1, vo.lowScoreDocuments().size());
        KbDashboardVO.DocumentScore doc = vo.lowScoreDocuments().get(0);
        assertEquals(Long.valueOf(999L), doc.documentId());
        assertNull(doc.title());
        assertEquals(Long.valueOf(7L), doc.libraryId());
        assertEquals(Double.valueOf(1.0D), doc.avgScore());
    }

    // ------------------------------------------------------------------ 数据构造

    private void stubFullDataset() {
        List<KbQaSession> sessions = List.of(
                session(3L, 10L, DAY2),
                session(2L, 11L, DAY1_LATE),
                session(1L, 10L, DAY1_EARLY));
        List<KbQaMessage> messages = List.of(
                message(101L, 1L, QaRole.USER.code(), "如何报销差旅？"),
                message(102L, 1L, QaRole.ASSISTANT.code(), "按《差旅管理办法》第三章…"),
                message(103L, 2L, QaRole.USER.code(), "如何报销差旅？"),
                message(104L, 2L, QaRole.ASSISTANT.code(), "需先在系统提交申请…"),
                message(105L, 3L, QaRole.USER.code(), "年假怎么算？"),
                message(106L, 3L, QaRole.ASSISTANT.code(), "按司龄折算…"));
        List<KbQaFeedback> feedbacks = List.of(
                feedback(1L, 1, 1, null, null),
                feedback(2L, 2, 2, null, null),
                feedback(3L, 5, 5, 1, null));
        List<KbQaCitation> citations = List.of(
                citation(1L, 102L, 7L, 70L),
                citation(2L, 102L, 7L, 71L),
                citation(3L, 104L, 7L, 70L),
                citation(4L, 104L, 8L, 80L),
                citation(5L, 106L, 8L, 80L));

        when(sessionRepository.findByCreatedAtBetweenOrderByIdDesc(any(), any())).thenReturn(sessions);
        when(messageRepository.findBySessionIdInOrderBySessionIdAscIdAsc(any())).thenReturn(messages);
        when(feedbackRepository.findBySessionIdIn(any())).thenReturn(feedbacks);
        when(citationRepository.findByMessageIdIn(any())).thenReturn(citations);
        when(libraryRepository.findAllById(any()))
                .thenReturn(List.of(library(7L, "制度库"), library(8L, "人事库")));
        when(documentRepository.findAllById(any())).thenReturn(List.of(
                document(70L, "差旅管理办法"),
                document(71L, "差旅附件"),
                document(80L, "年假实施细则")));
    }

    private static KbQaSession session(Long id, Long userId, Instant createdAt) {
        KbQaSession s = new KbQaSession();
        s.setId(id);
        s.setUserId(userId);
        s.setCreatedAt(createdAt);
        return s;
    }

    private static KbQaMessage message(Long id, Long sessionId, String role, String content) {
        KbQaMessage m = new KbQaMessage();
        m.setId(id);
        m.setSessionId(sessionId);
        m.setRole(role);
        m.setContent(content);
        return m;
    }

    private static KbQaFeedback feedback(
            Long sessionId, Integer accuracy, Integer helpful, Integer offtopic, Integer citeError) {
        KbQaFeedback f = new KbQaFeedback();
        f.setSessionId(sessionId);
        f.setAccuracy(accuracy);
        f.setHelpful(helpful);
        f.setOfftopic(offtopic);
        f.setCiteError(citeError);
        return f;
    }

    private static KbQaCitation citation(Long id, Long messageId, Long libraryId, Long documentId) {
        KbQaCitation c = new KbQaCitation();
        c.setId(id);
        c.setMessageId(messageId);
        c.setLibraryId(libraryId);
        c.setDocumentId(documentId);
        return c;
    }

    private static KbLibrary library(Long id, String name) {
        KbLibrary l = new KbLibrary();
        l.setId(id);
        l.setName(name);
        return l;
    }

    private static KbDocument document(Long id, String title) {
        KbDocument d = new KbDocument();
        d.setId(id);
        d.setTitle(title);
        return d;
    }
}
