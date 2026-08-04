package com.mis.kb.domain.service;

import com.mis.common.core.result.PageResult;
import com.mis.kb.api.dto.KbDashboardVO;
import com.mis.kb.api.dto.KbQaExportRow;
import com.mis.kb.api.dto.KbQaSessionListVO;
import com.mis.kb.api.dto.KbQaSessionQuery;
import com.mis.kb.domain.entity.KbDocument;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.entity.KbQaCitation;
import com.mis.kb.domain.entity.KbQaFeedback;
import com.mis.kb.domain.entity.KbQaMessage;
import com.mis.kb.domain.entity.KbQaSession;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.QaRole;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.domain.repository.KbQaCitationRepository;
import com.mis.kb.domain.repository.KbQaFeedbackRepository;
import com.mis.kb.domain.repository.KbQaMessageRepository;
import com.mis.kb.domain.repository.KbQaSessionRepository;
import com.mis.kb.support.KbBusinessException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * 运营数据聚合服务（A-02b 列表 / A-02d 看板 / A-02e 导出）。
 *
 * <p><b>为什么独立成类而不塞进 {@link KbQaService}：</b>{@code KbQaService} 的职责是
 * 问答主链路的落库与读取，已有 300+ 行；再叠加三套运营聚合会让它变成万能类。
 * 二者数据源相同但读写语义、权限口径、性能约束都不同（运营侧是宽表扫描 + 批量聚合），
 * 分开更易独立优化。<b>此为对设计文档 §2.2 的一处主动偏离，已在交付说明中记录。</b>
 *
 * <p><b>性能口径（重要，属已知限制）：</b>当前实现是「按时间区间捞会话 → 批量捞消息/引用/反馈
 * → 在内存里聚合」。数据量小时（P1 预期 ≤ 万级会话）完全够用，且避免了写一堆原生 SQL。
 * 但这是 <b>O(区间内全部会话)</b> 的内存聚合，会话量上到十万级后必须改成数据库侧聚合
 * （GROUP BY + 物化视图）。因此对导出加了 {@link #EXPORT_MAX_ROWS} 硬上限，
 * 超限直接报 {@link KbResultCode#KB_EXPORT_TOO_LARGE} 要求缩小范围，而不是硬扛到 OOM。
 */
@Service
public class KbOperationsService {

    private static final Logger log = LoggerFactory.getLogger(KbOperationsService.class);

    /** 导出行数硬上限（超限报错，不静默截断——截断会让运营拿到不完整数据还不自知）。 */
    public static final int EXPORT_MAX_ROWS = 10000;

    /** 列表页摘要文本截断长度。 */
    private static final int BRIEF_MAX_LEN = 200;

    /** 看板 Top 知识库取前 N。 */
    private static final int TOP_LIBRARY_LIMIT = 10;

    /** 高频差评问取前 N（PRD §6.6 图2 明确 Top10）。 */
    private static final int TOP_QUESTION_LIMIT = 10;

    /** 低分库 / 低分文档各取前 N。 */
    private static final int LOW_SCORE_LIMIT = 10;

    /** 好评分数下限（含）：综合分 ≥ 4 记为好评。 */
    private static final double POSITIVE_SCORE_MIN = 4.0D;

    /** 差评分数上限（含）：综合分 ≤ 2 记为差评。 */
    private static final double NEGATIVE_SCORE_MAX = 2.0D;

    /** 高频差评问的提问文本截断长度（过长的提问在图表里无法阅读，且会撑爆归并 key）。 */
    private static final int QUESTION_MAX_LEN = 80;

    /** 默认统计回溯天数（未传 from 时使用）。 */
    private static final long DEFAULT_LOOKBACK_DAYS = 30L;

    private static final DateTimeFormatter DAY_FORMATTER =
            DateTimeFormatter.ofPattern("yyyy-MM-dd").withZone(ZoneOffset.UTC);

    private final KbQaSessionRepository sessionRepository;
    private final KbQaMessageRepository messageRepository;
    private final KbQaCitationRepository citationRepository;
    private final KbQaFeedbackRepository feedbackRepository;
    private final KbLibraryRepository libraryRepository;
    private final KbDocumentRepository documentRepository;
    private final KbQaTicketService ticketService;

    public KbOperationsService(
            KbQaSessionRepository sessionRepository,
            KbQaMessageRepository messageRepository,
            KbQaCitationRepository citationRepository,
            KbQaFeedbackRepository feedbackRepository,
            KbLibraryRepository libraryRepository,
            KbDocumentRepository documentRepository,
            KbQaTicketService ticketService) {
        this.sessionRepository = sessionRepository;
        this.messageRepository = messageRepository;
        this.citationRepository = citationRepository;
        this.feedbackRepository = feedbackRepository;
        this.libraryRepository = libraryRepository;
        this.documentRepository = documentRepository;
        this.ticketService = ticketService;
    }

    // ---------------------------------------------------------------- A-02b 列表

    /**
     * 运营问答列表（带筛选与分页）。
     *
     * @param query 筛选条件
     * @return 分页结果
     */
    @Transactional(readOnly = true)
    public PageResult<KbQaSessionListVO> listSessions(KbQaSessionQuery query) {
        KbQaSessionQuery q = query == null
                ? new KbQaSessionQuery(null, null, null, null, null, null, null, null)
                : query;
        List<KbQaSessionListVO> all = buildRows(q);
        int page = q.effectivePage();
        int size = q.effectiveSize();
        int fromIndex = Math.min((page - 1) * size, all.size());
        int toIndex = Math.min(fromIndex + size, all.size());
        return PageResult.of(page, size, all.size(), all.subList(fromIndex, toIndex));
    }

    // ---------------------------------------------------------------- A-02e 导出

    /**
     * 导出行数据（A-02e）。
     *
     * <p>只产出结构化行；CSV 拼装与 userId 脱敏在 BFF {@code KbExportService} 完成。
     *
     * @param query 筛选条件（分页参数被忽略——导出取全量）
     * @return 导出行列表
     */
    @Transactional(readOnly = true)
    public List<KbQaExportRow> exportRows(KbQaSessionQuery query) {
        KbQaSessionQuery q = query == null
                ? new KbQaSessionQuery(null, null, null, null, null, null, null, null)
                : query;
        List<KbQaSessionListVO> rows = buildRows(q);
        if (rows.size() > EXPORT_MAX_ROWS) {
            log.warn("导出行数超限 rows={} limit={}", rows.size(), EXPORT_MAX_ROWS);
            throw new KbBusinessException(KbResultCode.KB_EXPORT_TOO_LARGE);
        }
        List<KbQaExportRow> result = new ArrayList<>(rows.size());
        for (KbQaSessionListVO row : rows) {
            result.add(new KbQaExportRow(
                    row.id(),
                    row.userId(),
                    row.createdAt() == null ? null : row.createdAt().toString(),
                    row.question(),
                    row.answerBrief(),
                    joinIds(row.libraryIds()),
                    row.citeCount(),
                    row.accuracy(),
                    row.helpful(),
                    null,
                    null));
        }
        return result;
    }

    // ---------------------------------------------------------------- A-02d 看板

    /**
     * 评价看板统计（A-02b 全指标）。
     *
     * <p>产出六组指标：①基础计数（会话/消息/反馈/工单）②好评率与均分
     * ③差评维度分布 ④高频差评问 Top10 ⑤低分库/文档 TopN ⑥按日趋势（含当日均分）。
     *
     * <p><b>好评/差评口径</b>见 {@link KbDashboardVO} 类注释：表里没有点赞点踩字段，
     * 一律由 accuracy/helpful 折算综合分后分档，且三个原始计数全部透出供换算。
     *
     * <p><b>成本</b>：整段是「区间会话 → 批量捞消息/引用/反馈 → 内存聚合」，
     * 与 {@link #buildRows} 同一套路，复杂度 O(区间内会话数)。会话量上到十万级时
     * 必须改数据库侧 GROUP BY——这是本类既有的已知限制，本次新增指标未使其变差
     * （没有引入任何逐会话的额外查询，只多了一次 {@code documentRepository.findAllById}）。
     *
     * @param from 起始时间；{@code null} 时回溯 {@value #DEFAULT_LOOKBACK_DAYS} 天
     * @param to   结束时间；{@code null} 时取当前
     * @return 看板数据；区间内无会话时返回空指标（仍带工单计数，工单不受区间约束）
     */
    @Transactional(readOnly = true)
    public KbDashboardVO stats(Instant from, Instant to) {
        Instant end = to != null ? to : Instant.now();
        Instant start = from != null ? from : end.minusSeconds(DEFAULT_LOOKBACK_DAYS * 24 * 3600);

        List<KbQaSession> sessions = sessionRepository.findByCreatedAtBetweenOrderByIdDesc(start, end);
        long openTickets = ticketService.countOpen();
        long totalTickets = ticketService.countAll();

        if (sessions.isEmpty()) {
            return new KbDashboardVO(
                    0L, 0L, 0L, 0.0D, null, null, 0L, 0L,
                    openTickets, totalTickets,
                    0L, 0L, 0L, null, null,
                    emptyDimensions(), List.of(), List.of(), List.of(), List.of(), List.of());
        }

        List<Long> sessionIds = sessions.stream().map(KbQaSession::getId).toList();
        List<KbQaMessage> messages = messageRepository.findBySessionIdInOrderBySessionIdAscIdAsc(sessionIds);
        List<KbQaFeedback> feedbacks = feedbackRepository.findBySessionIdIn(sessionIds);
        Map<Long, List<KbQaCitation>> citationsByMessage = loadCitations(messages);
        Map<Long, List<KbQaMessage>> messagesBySession = new HashMap<>();
        for (KbQaMessage m : messages) {
            messagesBySession.computeIfAbsent(m.getSessionId(), k -> new ArrayList<>()).add(m);
        }

        // --- 反馈聚合（计数类）
        long feedbackCount = feedbacks.size();
        long offtopicCount = feedbacks.stream()
                .filter(f -> f.getOfftopic() != null && f.getOfftopic() > 0).count();
        long citeErrorCount = feedbacks.stream()
                .filter(f -> f.getCiteError() != null && f.getCiteError() > 0).count();
        long lowAccuracyCount = feedbacks.stream()
                .filter(f -> f.getAccuracy() != null && f.getAccuracy() <= NEGATIVE_SCORE_MAX).count();
        long lowHelpfulCount = feedbacks.stream()
                .filter(f -> f.getHelpful() != null && f.getHelpful() <= NEGATIVE_SCORE_MAX).count();
        Double avgAccuracy = average(feedbacks.stream()
                .map(KbQaFeedback::getAccuracy).filter(Objects::nonNull).toList());
        Double avgHelpful = average(feedbacks.stream()
                .map(KbQaFeedback::getHelpful).filter(Objects::nonNull).toList());

        // --- 好评率与综合均分（按会话维度，一会话至多一条反馈）
        Map<Long, Double> scoreBySession = new HashMap<>();
        Set<Long> negativeSessionIds = new HashSet<>();
        long positiveCount = 0L;
        long negativeCount = 0L;
        for (KbQaFeedback f : feedbacks) {
            Double score = compositeScore(f);
            if (score != null) {
                scoreBySession.put(f.getSessionId(), score);
                if (score >= POSITIVE_SCORE_MIN) {
                    positiveCount++;
                } else if (score <= NEGATIVE_SCORE_MAX) {
                    negativeCount++;
                    negativeSessionIds.add(f.getSessionId());
                }
            }
            // 显式的问题标记（跑题/引用错误）即使评分不低，也算「有质量投诉」，纳入高频差评问统计
            if ((f.getOfftopic() != null && f.getOfftopic() > 0)
                    || (f.getCiteError() != null && f.getCiteError() > 0)) {
                negativeSessionIds.add(f.getSessionId());
            }
        }
        long ratedCount = scoreBySession.size();
        Double positiveRate = ratedCount == 0 ? null : round2((double) positiveCount / ratedCount);
        Double avgScore = averageOf(scoreBySession.values());

        List<KbDashboardVO.DimensionCount> negativeDimensions = List.of(
                new KbDashboardVO.DimensionCount("low_accuracy", "准确性不足", lowAccuracyCount),
                new KbDashboardVO.DimensionCount("low_helpful", "帮助性不足", lowHelpfulCount),
                new KbDashboardVO.DimensionCount("offtopic", "答非所问", offtopicCount),
                new KbDashboardVO.DimensionCount("cite_error", "引用错误", citeErrorCount));

        // --- 高频差评问 Top10（sessions 已按 id 倒序，首次出现即最近一条，作为下钻代表）
        Map<String, QuestionAgg> questionAgg = new LinkedHashMap<>();
        for (KbQaSession s : sessions) {
            if (!negativeSessionIds.contains(s.getId())) {
                continue;
            }
            String question = shorten(firstContent(
                    messagesBySession.getOrDefault(s.getId(), List.of()), QaRole.USER.code()));
            if (question == null || question.isBlank()) {
                continue;
            }
            questionAgg
                    .computeIfAbsent(question.toLowerCase(Locale.ROOT),
                            k -> new QuestionAgg(question, s.getId()))
                    .increment();
        }
        List<KbDashboardVO.QuestionCount> topNegativeQuestions = questionAgg.values().stream()
                .sorted(Comparator.comparingLong(QuestionAgg::count).reversed())
                .limit(TOP_QUESTION_LIMIT)
                .map(a -> new KbDashboardVO.QuestionCount(a.question(), a.count(), a.sessionId()))
                .toList();

        // --- 库/文档命中与低分归因（同一次遍历完成，避免重复展开引用）
        Map<Long, Long> hitByLibrary = new HashMap<>();
        Map<Long, double[]> libraryScoreAgg = new HashMap<>();
        Map<Long, double[]> documentScoreAgg = new HashMap<>();
        Map<Long, Long> libraryOfDocument = new HashMap<>();
        for (KbQaSession s : sessions) {
            Double score = scoreBySession.get(s.getId());
            Set<Long> sessionLibraryIds = new HashSet<>();
            Set<Long> sessionDocumentIds = new HashSet<>();
            for (KbQaMessage m : messagesBySession.getOrDefault(s.getId(), List.of())) {
                for (KbQaCitation c : citationsByMessage.getOrDefault(m.getId(), List.of())) {
                    if (c.getLibraryId() != null) {
                        hitByLibrary.merge(c.getLibraryId(), 1L, Long::sum);
                        sessionLibraryIds.add(c.getLibraryId());
                    }
                    if (c.getDocumentId() != null) {
                        sessionDocumentIds.add(c.getDocumentId());
                        if (c.getLibraryId() != null) {
                            libraryOfDocument.putIfAbsent(c.getDocumentId(), c.getLibraryId());
                        }
                    }
                }
            }
            if (score == null) {
                continue;
            }
            for (Long libraryId : sessionLibraryIds) {
                accumulate(libraryScoreAgg, libraryId, score);
            }
            for (Long documentId : sessionDocumentIds) {
                accumulate(documentScoreAgg, documentId, score);
            }
        }

        Set<Long> libraryIdsToName = new HashSet<>(hitByLibrary.keySet());
        libraryIdsToName.addAll(libraryScoreAgg.keySet());
        libraryIdsToName.addAll(libraryOfDocument.values());
        Map<Long, String> libraryNames = loadLibraryNames(libraryIdsToName);
        Map<Long, String> documentTitles = loadDocumentTitles(documentScoreAgg.keySet());

        List<KbDashboardVO.LibraryHit> topLibraries = hitByLibrary.entrySet().stream()
                .sorted(Map.Entry.<Long, Long>comparingByValue().reversed())
                .limit(TOP_LIBRARY_LIMIT)
                .map(e -> new KbDashboardVO.LibraryHit(
                        e.getKey(), libraryNames.get(e.getKey()), e.getValue()))
                .toList();

        List<KbDashboardVO.LibraryScore> lowScoreLibraries = libraryScoreAgg.entrySet().stream()
                .sorted(byAscendingAverage())
                .limit(LOW_SCORE_LIMIT)
                .map(e -> new KbDashboardVO.LibraryScore(
                        e.getKey(),
                        libraryNames.get(e.getKey()),
                        round2(e.getValue()[0] / e.getValue()[1]),
                        (long) e.getValue()[1]))
                .toList();

        List<KbDashboardVO.DocumentScore> lowScoreDocuments = documentScoreAgg.entrySet().stream()
                .sorted(byAscendingAverage())
                .limit(LOW_SCORE_LIMIT)
                .map(e -> new KbDashboardVO.DocumentScore(
                        e.getKey(),
                        libraryOfDocument.get(e.getKey()),
                        documentTitles.get(e.getKey()),
                        round2(e.getValue()[0] / e.getValue()[1]),
                        (long) e.getValue()[1]))
                .toList();

        // --- 按日趋势（会话数 / 反馈数 / 当日综合均分）
        Map<String, DayAgg> daily = new LinkedHashMap<>();
        for (KbQaSession s : sessions) {
            String day = dayKey(s.getCreatedAt());
            DayAgg agg = daily.computeIfAbsent(day, k -> new DayAgg());
            agg.sessionCount++;
            Double score = scoreBySession.get(s.getId());
            if (score != null) {
                agg.scoreSum += score;
                agg.scoreCount++;
            }
        }
        Map<Long, KbQaSession> sessionById = new HashMap<>();
        sessions.forEach(s -> sessionById.put(s.getId(), s));
        for (KbQaFeedback f : feedbacks) {
            KbQaSession s = sessionById.get(f.getSessionId());
            if (s == null) {
                continue;
            }
            daily.computeIfAbsent(dayKey(s.getCreatedAt()), k -> new DayAgg()).feedbackCount++;
        }
        List<KbDashboardVO.DailyPoint> trend = daily.entrySet().stream()
                .map(e -> new KbDashboardVO.DailyPoint(
                        e.getKey(),
                        e.getValue().sessionCount,
                        e.getValue().feedbackCount,
                        e.getValue().scoreCount == 0
                                ? null
                                : round2(e.getValue().scoreSum / e.getValue().scoreCount)))
                .sorted(Comparator.comparing(KbDashboardVO.DailyPoint::date))
                .toList();

        double feedbackRate = round2((double) feedbackCount / sessions.size());

        return new KbDashboardVO(
                sessions.size(),
                messages.size(),
                feedbackCount,
                feedbackRate,
                avgAccuracy,
                avgHelpful,
                offtopicCount,
                citeErrorCount,
                openTickets,
                totalTickets,
                ratedCount,
                positiveCount,
                negativeCount,
                positiveRate,
                avgScore,
                negativeDimensions,
                topNegativeQuestions,
                lowScoreLibraries,
                lowScoreDocuments,
                trend,
                topLibraries);
    }

    // ---------------------------------------------------------------- 内部

    /**
     * 构建列表行（列表与导出共用）。
     *
     * <p>按 {@code query} 的时间区间一次性捞会话，再批量捞消息/引用/反馈做内存聚合，
     * 避免逐行查询造成的 N+1。筛选顺序：时间 → 库 → 用户 → 反馈 → 关键字。
     */
    private List<KbQaSessionListVO> buildRows(KbQaSessionQuery q) {
        Instant end = q.to() != null ? q.to() : Instant.now();
        Instant start = q.from() != null
                ? q.from()
                : end.minusSeconds(DEFAULT_LOOKBACK_DAYS * 24 * 3600);

        List<KbQaSession> sessions = sessionRepository.findByCreatedAtBetweenOrderByIdDesc(start, end);
        if (q.userId() != null) {
            sessions = sessions.stream()
                    .filter(s -> q.userId().equals(s.getUserId()))
                    .toList();
        }
        if (sessions.isEmpty()) {
            return List.of();
        }

        List<Long> sessionIds = sessions.stream().map(KbQaSession::getId).toList();
        Map<Long, List<KbQaMessage>> messagesBySession = new HashMap<>();
        for (KbQaMessage m : messageRepository.findBySessionIdInOrderBySessionIdAscIdAsc(sessionIds)) {
            messagesBySession.computeIfAbsent(m.getSessionId(), k -> new ArrayList<>()).add(m);
        }
        List<KbQaMessage> allMessages = messagesBySession.values().stream()
                .flatMap(List::stream).toList();
        Map<Long, List<KbQaCitation>> citationsByMessage = loadCitations(allMessages);
        Map<Long, KbQaFeedback> feedbackBySession = new HashMap<>();
        for (KbQaFeedback f : feedbackRepository.findBySessionIdIn(sessionIds)) {
            feedbackBySession.put(f.getSessionId(), f);
        }

        String keyword = q.keyword() == null || q.keyword().isBlank()
                ? null : q.keyword().trim().toLowerCase();

        List<KbQaSessionListVO> rows = new ArrayList<>();
        for (KbQaSession s : sessions) {
            List<KbQaMessage> msgs = messagesBySession.getOrDefault(s.getId(), List.of());

            String question = firstContent(msgs, QaRole.USER.code());
            String answer = firstContent(msgs, QaRole.ASSISTANT.code());

            Set<Long> libraryIds = new HashSet<>();
            int citeCount = 0;
            for (KbQaMessage m : msgs) {
                for (KbQaCitation c : citationsByMessage.getOrDefault(m.getId(), List.of())) {
                    citeCount++;
                    if (c.getLibraryId() != null) {
                        libraryIds.add(c.getLibraryId());
                    }
                }
            }

            // 库维度筛选：只保留命中了指定库的会话
            if (q.libraryId() != null && !libraryIds.contains(q.libraryId())) {
                continue;
            }
            KbQaFeedback fb = feedbackBySession.get(s.getId());
            boolean hasFeedback = fb != null;
            if (q.hasFeedback() != null && q.hasFeedback() != hasFeedback) {
                continue;
            }
            if (keyword != null && (question == null || !question.toLowerCase().contains(keyword))) {
                continue;
            }

            rows.add(new KbQaSessionListVO(
                    s.getId(),
                    s.getUserId(),
                    s.getAppId(),
                    s.getCreatedAt(),
                    brief(question),
                    brief(answer),
                    msgs.size(),
                    citeCount,
                    new ArrayList<>(libraryIds),
                    hasFeedback,
                    fb == null ? null : fb.getAccuracy(),
                    fb == null ? null : fb.getHelpful()));
        }
        return rows;
    }

    private Map<Long, List<KbQaCitation>> loadCitations(List<KbQaMessage> messages) {
        if (messages.isEmpty()) {
            return Map.of();
        }
        List<Long> messageIds = messages.stream().map(KbQaMessage::getId).toList();
        Map<Long, List<KbQaCitation>> byMessage = new HashMap<>();
        for (KbQaCitation c : citationRepository.findByMessageIdIn(messageIds)) {
            byMessage.computeIfAbsent(c.getMessageId(), k -> new ArrayList<>()).add(c);
        }
        return byMessage;
    }

    private Map<Long, String> loadLibraryNames(Set<Long> libraryIds) {
        if (libraryIds == null || libraryIds.isEmpty()) {
            return Map.of();
        }
        Map<Long, String> names = new HashMap<>();
        for (KbLibrary lib : libraryRepository.findAllById(libraryIds)) {
            names.put(lib.getId(), lib.getName());
        }
        return names;
    }

    /**
     * 批量取文档标题（低分文档 TopN 用）。
     *
     * <p>文档可能已被删除（引用是历史快照），此时 map 里就没有该 id，
     * VO 的 {@code title} 留 {@code null} 由前端回落展示 `#id`——
     * 不要在这里编造「已删除文档」之类的假标题，运营需要看到的是「查不到名字」这个事实。
     */
    private Map<Long, String> loadDocumentTitles(Set<Long> documentIds) {
        if (documentIds == null || documentIds.isEmpty()) {
            return Map.of();
        }
        Map<Long, String> titles = new HashMap<>();
        for (KbDocument doc : documentRepository.findAllById(documentIds)) {
            titles.put(doc.getId(), doc.getTitle());
        }
        return titles;
    }

    private static String firstContent(List<KbQaMessage> messages, String role) {
        for (KbQaMessage m : messages) {
            if (role.equals(m.getRole())) {
                return m.getContent();
            }
        }
        return null;
    }

    private static String brief(String text) {
        if (text == null) {
            return null;
        }
        String oneLine = text.replaceAll("\\s+", " ").trim();
        return oneLine.length() <= BRIEF_MAX_LEN ? oneLine : oneLine.substring(0, BRIEF_MAX_LEN) + "…";
    }

    private static String joinIds(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < ids.size(); i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(ids.get(i));
        }
        return sb.toString();
    }

    private static Double average(List<Integer> values) {
        if (values == null || values.isEmpty()) {
            return null;
        }
        double sum = 0;
        for (Integer v : values) {
            sum += v;
        }
        return Math.round(sum / values.size() * 100.0D) / 100.0D;
    }

    /**
     * 综合评分：accuracy 与 helpful 中非空项的均值；两者皆空视为未评分返回 {@code null}。
     *
     * <p>好评/差评分档（{@link #POSITIVE_SCORE_MIN}/{@link #NEGATIVE_SCORE_MAX}）都以本值为准，
     * 口径详情见 {@link KbDashboardVO} 类注释。
     */
    private static Double compositeScore(KbQaFeedback f) {
        Integer accuracy = f.getAccuracy();
        Integer helpful = f.getHelpful();
        if (accuracy == null && helpful == null) {
            return null;
        }
        int sum = 0;
        int n = 0;
        if (accuracy != null) {
            sum += accuracy;
            n++;
        }
        if (helpful != null) {
            sum += helpful;
            n++;
        }
        return (double) sum / n;
    }

    /**
     * 差评维度分布的四个零计数桶（区间内无反馈时复用，保证前端拿到固定四桶不缺列）。
     */
    private static List<KbDashboardVO.DimensionCount> emptyDimensions() {
        return List.of(
                new KbDashboardVO.DimensionCount("low_accuracy", "准确性不足", 0L),
                new KbDashboardVO.DimensionCount("low_helpful", "帮助性不足", 0L),
                new KbDashboardVO.DimensionCount("offtopic", "答非所问", 0L),
                new KbDashboardVO.DimensionCount("cite_error", "引用错误", 0L));
    }

    /**
     * 折叠空白并截断到 {@link #QUESTION_MAX_LEN}，用于高频差评问的归并 key 与展示。
     */
    private static String shorten(String text) {
        if (text == null) {
            return null;
        }
        String oneLine = text.replaceAll("\\s+", " ").trim();
        return oneLine.length() <= QUESTION_MAX_LEN
                ? oneLine
                : oneLine.substring(0, QUESTION_MAX_LEN);
    }

    /**
     * 把一条评分累加到「id → [sum, count]」桶里（库/文档低分归因共用）。
     */
    private static void accumulate(Map<Long, double[]> agg, Long id, double score) {
        double[] slot = agg.computeIfAbsent(id, k -> new double[2]);
        slot[0] += score;
        slot[1] += 1.0D;
    }

    /**
     * 按平均分升序（低分在前）；同分按 id 升序保证稳定，避免 TopN 边界抖动。
     */
    private static Comparator<Map.Entry<Long, double[]>> byAscendingAverage() {
        return Comparator
                .comparingDouble((Map.Entry<Long, double[]> e) -> e.getValue()[0] / e.getValue()[1])
                .thenComparing(Map.Entry::getKey);
    }

    /**
     * 会话时间 → 日期串（UTC）。{@code null} 时间回落 "unknown"，不让 NPE 炸掉整段统计。
     */
    private static String dayKey(Instant instant) {
        if (instant == null) {
            return "unknown";
        }
        return DAY_FORMATTER.format(instant);
    }

    /** 保留两位小数（四舍五入）。 */
    private static Double round2(double d) {
        return Math.round(d * 100.0D) / 100.0D;
    }

    /**
     * 对一组 Double 求均值；全部为 {@code null} 或空时返回 {@code null}（不用 0 兜底）。
     */
    private static Double averageOf(Collection<Double> values) {
        if (values == null || values.isEmpty()) {
            return null;
        }
        double sum = 0;
        int n = 0;
        for (Double v : values) {
            if (v != null) {
                sum += v;
                n++;
            }
        }
        return n == 0 ? null : Math.round(sum / n * 100.0D) / 100.0D;
    }

    /**
     * 高频差评问归并桶：同文本（忽略大小写）多会话归并计数，保留一条最近的代表会话 id 供下钻。
     *
     * <p>注意：{@link #stats} 里每次命中都调 {@link #increment()}，故构造时计 0、首次调用归一并后为 1。
     */
    private static final class QuestionAgg {
        private final String question;
        private final Long sessionId;
        private long count;

        QuestionAgg(String question, Long sessionId) {
            this.question = question;
            this.sessionId = sessionId;
            this.count = 0L;
        }

        void increment() {
            count++;
        }

        String question() {
            return question;
        }

        Long sessionId() {
            return sessionId;
        }

        long count() {
            return count;
        }
    }

    /**
     * 按日聚合桶：会话数 / 反馈数 / 综合分累加。
     */
    private static final class DayAgg {
        private long sessionCount;
        private long feedbackCount;
        private double scoreSum;
        private long scoreCount;
    }
}
