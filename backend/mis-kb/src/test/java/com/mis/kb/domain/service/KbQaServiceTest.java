package com.mis.kb.domain.service;

import com.mis.kb.api.dto.KbQaSessionVO;
import com.mis.kb.api.dto.QaSessionCreateRequest;
import com.mis.kb.domain.entity.KbQaSession;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.repository.KbAclRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.domain.repository.KbQaCitationRepository;
import com.mis.kb.domain.repository.KbQaFeedbackRepository;
import com.mis.kb.domain.repository.KbQaMessageRepository;
import com.mis.kb.domain.repository.KbQaSessionRepository;
import com.mis.kb.support.KbBusinessException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
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
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link KbQaService} 会话管理单测（手动新建 + 标题 + 软删除）。
 *
 * <p>只用 Mockito 假仓储，**不启 Spring 容器、不连数据库**——验证的是
 * {@link KbQaService} 的编排逻辑：标题截断、用户侧软删过滤、删除幂等与归属校验。
 * 派生查询属性名正确性由真实启动（连 dev 栈 PG）时 Hibernate 校验。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class KbQaServiceTest {

    private static final long USER = 1001L;

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
    private KbAclRepository aclRepository;

    private KbQaService qaService;

    @BeforeEach
    void setUp() {
        qaService = new KbQaService(
                sessionRepository,
                messageRepository,
                citationRepository,
                feedbackRepository,
                libraryRepository,
                aclRepository);
    }

    // ---------------------------------------------------------------- createSession：标题

    @Test
    @DisplayName("createSession：正常标题原样落库，VO 透出 title")
    void createSession_keepsTitleAndVoCarriesIt() {
        when(sessionRepository.save(any(KbQaSession.class)))
                .thenAnswer(inv -> inv.getArgument(0));

        Long id = qaService.createSession(
                new QaSessionCreateRequest(USER, 91010L, "差旅住宿标准是多少？"), USER);

        assertNotNull(id);
        KbQaSession saved = captureSaved();
        assertEquals("差旅住宿标准是多少？", saved.getTitle());
        assertNull(saved.getDeletedAt());
    }

    @Test
    @DisplayName("createSession：标题为 null 不落库标题（保持可空兜底）")
    void createSession_nullTitleStaysNull() {
        when(sessionRepository.save(any(KbQaSession.class)))
                .thenAnswer(inv -> inv.getArgument(0));

        qaService.createSession(new QaSessionCreateRequest(USER, 91010L, null), USER);

        assertNull(captureSaved().getTitle());
    }

    @Test
    @DisplayName("createSession：超 255 字符标题截断到 255（VARCHAR 上限防御）")
    void createSession_truncatesOverlongTitle() {
        when(sessionRepository.save(any(KbQaSession.class)))
                .thenAnswer(inv -> inv.getArgument(0));

        String longTitle = "问".repeat(300);
        qaService.createSession(new QaSessionCreateRequest(USER, 91010L, longTitle), USER);

        String saved = captureSaved().getTitle();
        assertEquals(255, saved.length());
        assertEquals("问".repeat(255), saved);
    }

    // ---------------------------------------------------------------- listMySessions：软删过滤

    @Test
    @DisplayName("listMySessions：走软删过滤仓储方法，VO 带 title")
    void listMySessions_filtersSoftDeletedAndCarriesTitle() {
        KbQaSession s1 = session(1L, USER, "标题一", null);
        KbQaSession s2 = session(2L, USER, "标题二", Instant.now());
        when(sessionRepository.findByUserIdAndDeletedAtIsNullOrderByIdDesc(USER))
                .thenReturn(List.of(s1));

        List<KbQaSessionVO> vos = qaService.listMySessions(USER);

        verify(sessionRepository).findByUserIdAndDeletedAtIsNullOrderByIdDesc(USER);
        verify(sessionRepository, never()).findByUserIdOrderByIdDesc(anyLong());
        assertEquals(1, vos.size());
        assertEquals(1L, vos.get(0).id());
        assertEquals("标题一", vos.get(0).title());
    }

    @Test
    @DisplayName("listMySessions：userId 为 null 返回空列表，不打仓储")
    void listMySessions_nullUserReturnsEmpty() {
        assertEquals(List.of(), qaService.listMySessions(null));
        verify(sessionRepository, never()).findByUserIdAndDeletedAtIsNullOrderByIdDesc(anyLong());
    }

    // ---------------------------------------------------------------- deleteSession：幂等 + 归属

    @Test
    @DisplayName("deleteSession：本人删除置 deletedAt 并保存")
    void deleteSession_ownedMarksSoftDeleted() {
        KbQaSession s = session(1L, USER, "标题", null);
        when(sessionRepository.findById(1L)).thenReturn(Optional.of(s));
        when(sessionRepository.save(any(KbQaSession.class))).thenAnswer(inv -> inv.getArgument(0));

        qaService.deleteSession(1L, USER);

        assertNotNull(s.getDeletedAt());
        verify(sessionRepository).save(s);
    }

    @Test
    @DisplayName("deleteSession：重复删幂等成功（已软删会话再次删除仍成功）")
    void deleteSession_idempotentOnAlreadyDeleted() {
        KbQaSession s = session(1L, USER, "标题", Instant.now());
        when(sessionRepository.findById(1L)).thenReturn(Optional.of(s));
        when(sessionRepository.save(any(KbQaSession.class))).thenAnswer(inv -> inv.getArgument(0));

        qaService.deleteSession(1L, USER);
        qaService.deleteSession(1L, USER);

        verify(sessionRepository, times(2)).save(s);
        assertNotNull(s.getDeletedAt());
    }

    @Test
    @DisplayName("deleteSession：非本人抛 KB_SESSION_NOT_FOUND（不泄露存在性）")
    void deleteSession_notOwnerThrowsNotFound() {
        KbQaSession s = session(1L, 999L, "标题", null);
        when(sessionRepository.findById(1L)).thenReturn(Optional.of(s));

        KbBusinessException ex = assertThrows(
                KbBusinessException.class, () -> qaService.deleteSession(1L, USER));

        assertEquals(KbResultCode.KB_SESSION_NOT_FOUND.getCode(), ex.getCode());
        verify(sessionRepository, never()).save(any(KbQaSession.class));
    }

    @Test
    @DisplayName("deleteSession：会话不存在抛 KB_SESSION_NOT_FOUND")
    void deleteSession_missingThrowsNotFound() {
        when(sessionRepository.findById(99L)).thenReturn(Optional.empty());

        KbBusinessException ex = assertThrows(
                KbBusinessException.class, () -> qaService.deleteSession(99L, USER));

        assertEquals(KbResultCode.KB_SESSION_NOT_FOUND.getCode(), ex.getCode());
    }

    // ---------------------------------------------------------------- 内部辅助

    private KbQaSession captureSaved() {
        return (KbQaSession) org.mockito.Mockito.mockingDetails(sessionRepository)
                .getInvocations().stream()
                .filter(inv -> inv.getMethod().getName().equals("save"))
                .reduce((a, b) -> b)
                .orElseThrow(() -> new AssertionError("sessionRepository.save 未被调用"))
                .getArgument(0);
    }

    private static KbQaSession session(Long id, Long userId, String title, Instant deletedAt) {
        KbQaSession s = new KbQaSession();
        s.setId(id);
        s.setUserId(userId);
        s.setAppId(91010L);
        s.setTitle(title);
        s.setCreatedAt(Instant.parse("2026-08-01T02:00:00Z"));
        s.setDeletedAt(deletedAt);
        return s;
    }
}
