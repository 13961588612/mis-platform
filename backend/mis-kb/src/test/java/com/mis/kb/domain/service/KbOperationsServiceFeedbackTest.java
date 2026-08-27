package com.mis.kb.domain.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.kb.api.dto.KbDashboardVO;
import com.mis.kb.api.dto.KbQaExportRow;
import com.mis.kb.api.dto.KbQaFeedbackVO;
import com.mis.kb.api.dto.KbQaSessionListVO;
import com.mis.kb.api.dto.KbQaSessionQuery;
import com.mis.kb.domain.entity.KbQaCitation;
import com.mis.kb.domain.entity.KbQaFeedback;
import com.mis.kb.domain.entity.KbQaMessage;
import com.mis.kb.domain.entity.KbQaSession;
import com.mis.kb.domain.entity.KbQaTicket;
import com.mis.kb.domain.model.QaRole;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.domain.repository.KbQaCitationRepository;
import com.mis.kb.domain.repository.KbQaFeedbackRepository;
import com.mis.kb.domain.repository.KbQaMessageRepository;
import com.mis.kb.domain.repository.KbQaSessionRepository;
import com.mis.kb.domain.repository.KbQaTicketRepository;
import com.mis.kb.support.KbBusinessException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 运营反馈闭环独立验证（OP-01 / OP-05 / OP-06）。
 *
 * <p>与 {@link KbOperationsServiceStatsTest} 同一个套路：只用 Mockito 假仓储喂入构造数据，
 * 不启 Spring、不连数据库，验证的是纯内存聚合与状态机逻辑。
 *
 * <p>覆盖点：
 * <ul>
 *   <li>OP-05 {@code markFeedbackProcessed} 状态机：pending→handled/ignored、终态不可回退、
 *       同态幂等、非法 status 拦截、反馈不存在拦截、处理人/备注落库；</li>
 *   <li>OP-01 列表 {@code sentiment} 筛选：好评/差评口径与看板同源、中性分(2~4 且无标记)既非好评也非差评、
 *       无反馈行在按评价筛选时正确排除；</li>
 *   <li>OP-06 导出：offtopic/citeError 两列不再恒为 null（修复项）、导出同样支持 sentiment 筛选。</li>
 * </ul>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class KbOperationsServiceFeedbackTest {

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
    private KbQaTicketRepository ticketRepository;
    @Mock
    private KbQaTicketService ticketService;

    private KbOperationsService service;

    private static final Instant T = Instant.parse("2026-08-13T02:00:00Z");

    @BeforeEach
    void setUp() {
        service = new KbOperationsService(
                sessionRepository, messageRepository, citationRepository,
                feedbackRepository, libraryRepository, documentRepository,
                ticketRepository, ticketService);
        when(ticketService.countOpen()).thenReturn(0L);
        when(ticketService.countAll()).thenReturn(0L);
        when(citationRepository.findByMessageIdIn(any())).thenReturn(List.of());
        when(libraryRepository.findAllById(any())).thenReturn(List.of());
        when(documentRepository.findAllById(any())).thenReturn(List.of());
        when(ticketRepository.findBySessionIdInOrderByIdDesc(any())).thenReturn(List.of());
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clear();
    }

    // ================================================================== OP-05

    @Test
    void markFeedbackProcessed_handlePersistsStatusHandlerAndNote() {
        LoginUser u = new LoginUser();
        u.setUserId(99L);
        u.setUsername("op-zhang");
        SecurityContextHolder.setLoginUser(u);

        KbQaFeedback fb = feedback(10L, 1L, 1, 1, null, null, "pending");
        when(feedbackRepository.findById(10L)).thenReturn(Optional.of(fb));
        when(feedbackRepository.save(any(KbQaFeedback.class))).thenAnswer(inv -> inv.getArgument(0));

        KbQaFeedbackVO vo = service.markFeedbackProcessed(10L, "handled", "note-x", 99L);

        assertEquals("handled", vo.feedbackStatus());
        assertEquals(99L, vo.handlerId());
        assertEquals("op-zhang", vo.handlerName());
        assertEquals("note-x", vo.handleNote());
        assertEquals("handled", fb.getFeedbackStatus());
        assertEquals(99L, fb.getHandlerId());
        assertEquals("op-zhang", fb.getHandlerName());
        verify(feedbackRepository).save(fb);
    }

    @Test
    void markFeedbackProcessed_ignorePersistsStatus() {
        KbQaFeedback fb = feedback(11L, 2L, 5, 5, null, null, "pending");
        when(feedbackRepository.findById(11L)).thenReturn(Optional.of(fb));
        when(feedbackRepository.save(any(KbQaFeedback.class))).thenAnswer(inv -> inv.getArgument(0));

        KbQaFeedbackVO vo = service.markFeedbackProcessed(11L, "ignored", null, 7L);

        assertEquals("ignored", vo.feedbackStatus());
        assertEquals(7L, vo.handlerId());
        verify(feedbackRepository).save(fb);
    }

    @Test
    void markFeedbackProcessed_terminalToDifferentStatusIllegal() {
        KbQaFeedback fb = feedback(12L, 1L, 1, 1, null, null, "handled");
        when(feedbackRepository.findById(12L)).thenReturn(Optional.of(fb));

        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> service.markFeedbackProcessed(12L, "ignored", null, 1L));
        assertTrue(ex.getMessage().contains("非法"));
        // 终态不可回退：不应落库
        verify(feedbackRepository, never()).save(any(KbQaFeedback.class));
    }

    @Test
    void markFeedbackProcessed_sameTerminalStatusIdempotent() {
        KbQaFeedback fb = feedback(13L, 1L, 1, 1, null, null, "ignored");
        when(feedbackRepository.findById(13L)).thenReturn(Optional.of(fb));

        KbQaFeedbackVO vo = service.markFeedbackProcessed(13L, "ignored", "changed-note", 1L);

        assertEquals("ignored", vo.feedbackStatus());
        // 幂等：不更新、不落库、不改备注
        verify(feedbackRepository, never()).save(any(KbQaFeedback.class));
    }

    @Test
    void markFeedbackProcessed_invalidStatusRejected() {
        KbQaFeedback fb = feedback(14L, 1L, 1, 1, null, null, "pending");
        when(feedbackRepository.findById(14L)).thenReturn(Optional.of(fb));

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.markFeedbackProcessed(14L, "weird", null, 1L));
        assertTrue(ex.getMessage().contains("handled/ignored"));
        verify(feedbackRepository, never()).save(any(KbQaFeedback.class));
    }

    @Test
    void markFeedbackProcessed_notFound() {
        when(feedbackRepository.findById(999L)).thenReturn(Optional.empty());

        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> service.markFeedbackProcessed(999L, "handled", null, 1L));
        assertTrue(ex.getMessage().contains("不存在"));
        verify(feedbackRepository, never()).save(any(KbQaFeedback.class));
    }

    // ================================================================== OP-01

    @Test
    void listSessions_sentimentFilterPositiveNegative() {
        List<KbQaSession> sessions = List.of(
                session(1L, 10L, T), session(2L, 11L, T), session(3L, 12L, T));
        List<KbQaMessage> messages = List.of(
                message(101L, 1L, QaRole.USER.code(), "q1"),
                message(102L, 1L, QaRole.ASSISTANT.code(), "a1"),
                message(103L, 2L, QaRole.USER.code(), "q2"),
                message(104L, 2L, QaRole.ASSISTANT.code(), "a2"),
                message(105L, 3L, QaRole.USER.code(), "q3"),
                message(106L, 3L, QaRole.ASSISTANT.code(), "a3"));
        List<KbQaFeedback> feedbacks = List.of(
                feedback(1L, 1L, 1, 1, null, null, "pending"),   // 综合 1.0 → 差评
                feedback(2L, 2L, 5, 5, null, null, "pending"));  // 综合 5.0 → 好评
        // 会话 3 无反馈

        stubForList(sessions, messages, feedbacks);

        // 差评筛选：仅会话 1
        var negative = service.listSessions(new KbQaSessionQuery(
                null, null, null, null, null, "negative", null, null, null));
        assertEquals(1, negative.getList().size());
        assertEquals(Long.valueOf(1L), negative.getList().get(0).id());
        assertEquals("negative", negative.getList().get(0).sentiment());

        // 好评筛选：仅会话 2
        var positive = service.listSessions(new KbQaSessionQuery(
                null, null, null, null, null, "positive", null, null, null));
        assertEquals(1, positive.getList().size());
        assertEquals(Long.valueOf(2L), positive.getList().get(0).id());
        assertEquals("positive", positive.getList().get(0).sentiment());

        // 不限：三条都在
        var all = service.listSessions(new KbQaSessionQuery(
                null, null, null, null, null, null, null, null, null));
        assertEquals(3, all.getList().size());
    }

    @Test
    void listSessions_neutralScoreMatchesNeitherPositiveNorNegative() {
        // 综合分 3.0，无 offtopic/citeError 标记 → 既非好评也非差评
        KbQaFeedback neutral = feedback(1L, 1L, 3, 3, null, null, "pending");
        List<KbQaSession> sessions = List.of(session(1L, 10L, T));
        List<KbQaMessage> messages = List.of(
                message(101L, 1L, QaRole.USER.code(), "q"),
                message(102L, 1L, QaRole.ASSISTANT.code(), "a"));
        stubForList(sessions, messages, List.of(neutral));

        var positive = service.listSessions(new KbQaSessionQuery(
                null, null, null, null, null, "positive", null, null, null));
        var negative = service.listSessions(new KbQaSessionQuery(
                null, null, null, null, null, "negative", null, null, null));

        assertEquals(0, positive.getList().size());
        assertEquals(0, negative.getList().size());
    }

    // ================================================================== OP-06

    @Test
    void exportRows_carriesOfftopicAndCiteError() {
        // 修复项：导出行必须带 offtopic / citeError（此前恒为 null）
        KbQaFeedback fb = feedback(1L, 1L, 1, 1, 5, 1, "pending");
        List<KbQaSession> sessions = List.of(session(1L, 10L, T));
        List<KbQaMessage> messages = List.of(
                message(101L, 1L, QaRole.USER.code(), "q"),
                message(102L, 1L, QaRole.ASSISTANT.code(), "a"));
        stubForList(sessions, messages, List.of(fb));

        List<KbQaExportRow> rows = service.exportRows(new KbQaSessionQuery(
                null, null, null, null, null, null, null, null, null));

        assertEquals(1, rows.size());
        assertEquals(Integer.valueOf(5), rows.get(0).offtopic());
        assertEquals(Integer.valueOf(1), rows.get(0).citeError());
        assertEquals(Integer.valueOf(1), rows.get(0).accuracy());
    }

    @Test
    void exportRows_supportsSentimentFilter() {
        KbQaFeedback down = feedback(1L, 1L, 1, 1, 5, 1, "pending");   // 差评
        KbQaFeedback up = feedback(2L, 2L, 5, 5, null, null, "pending"); // 好评
        List<KbQaSession> sessions = List.of(session(1L, 10L, T), session(2L, 11L, T));
        List<KbQaMessage> messages = List.of(
                message(101L, 1L, QaRole.USER.code(), "q1"),
                message(102L, 1L, QaRole.ASSISTANT.code(), "a1"),
                message(103L, 2L, QaRole.USER.code(), "q2"),
                message(104L, 2L, QaRole.ASSISTANT.code(), "a2"));
        stubForList(sessions, messages, List.of(down, up));

        // 导出按「差评」筛选：只有会话 1
        List<KbQaExportRow> rows = service.exportRows(new KbQaSessionQuery(
                null, null, null, null, null, "negative", null, null, null));
        assertEquals(1, rows.size());
        assertEquals(Long.valueOf(1L), rows.get(0).sessionId());
        assertEquals(Integer.valueOf(5), rows.get(0).offtopic());
    }

    // ================================================================== OP-05 看板待处理反馈计数

    @Test
    void stats_pendingFeedbackCountWired() {
        KbQaFeedback fb = feedback(1L, 1L, 1, 1, null, null, "handled");
        List<KbQaSession> sessions = List.of(session(1L, 10L, T));
        List<KbQaMessage> messages = List.of(
                message(101L, 1L, QaRole.USER.code(), "q"),
                message(102L, 1L, QaRole.ASSISTANT.code(), "a"));
        when(sessionRepository.findByCreatedAtBetweenOrderByIdDesc(any(), any())).thenReturn(sessions);
        when(messageRepository.findBySessionIdInOrderBySessionIdAscIdAsc(any())).thenReturn(messages);
        when(feedbackRepository.findBySessionIdIn(any())).thenReturn(List.of(fb));
        when(feedbackRepository.countByFeedbackStatus("pending")).thenReturn(2L);

        KbDashboardVO vo = service.stats(T, T);

        // 待处理反馈计数取自 countByFeedbackStatus("pending")，与数据集解耦
        assertEquals(2L, vo.pendingFeedback());
    }

    // ================================================================== 数据构造

    private void stubForList(
            List<KbQaSession> sessions,
            List<KbQaMessage> messages,
            List<KbQaFeedback> feedbacks) {
        when(sessionRepository.findByCreatedAtBetweenOrderByIdDesc(any(), any())).thenReturn(sessions);
        when(messageRepository.findBySessionIdInOrderBySessionIdAscIdAsc(any())).thenReturn(messages);
        when(feedbackRepository.findBySessionIdIn(any())).thenReturn(feedbacks);
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
            Long id, Long sessionId, Integer accuracy, Integer helpful,
            Integer offtopic, Integer citeError, String status) {
        KbQaFeedback f = new KbQaFeedback();
        f.setId(id);
        f.setSessionId(sessionId);
        f.setAccuracy(accuracy);
        f.setHelpful(helpful);
        f.setOfftopic(offtopic);
        f.setCiteError(citeError);
        f.setFeedbackStatus(status == null ? "pending" : status);
        return f;
    }
}
