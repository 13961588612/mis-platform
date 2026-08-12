package com.mis.kb.domain.service;

import com.mis.kb.api.dto.KbRaptorBuildResultVO;
import com.mis.kb.api.dto.KbRaptorStatusVO;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.EngineCapabilities;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.model.RaptorBuildSnapshot;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.support.KbBusinessException;
import com.mis.kb.support.KbJson;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * KbRaptorService 状态机 + 能力/前置校验测试（Wave C RAPTOR，T04）。
 *
 * <p>锁定设计 §2.3 / U4 裁定与共享知识 §10-10：
 * <ol>
 *   <li><b>U4 无库数上限</b>：本服务<b>不存在</b> {@code KB_RAPTOR_LIBRARY_LIMIT}——
 *       能力闸门（{@code KB_RAPTOR_UNSUPPORTED}）与状态机（{@code building} 拒绝重复触发）
 *       之外不设任何数量限制；</li>
 *   <li><b>状态机</b>：{@code none → building → ready|failed →（重试）building}；
 *       {@code building} 拒绝重复触发（{@code KB_RAPTOR_BUILD_IN_PROGRESS}）；
 *       {@code ready} 清 {@code raptorBuildMessage}；</li>
 *   <li><b>刷新回写</b>：引擎 READY/FAILED/BUILDING 映射写库；NONE（无任务）保留本地（R6）。</li>
 * </ol>
 */
class KbRaptorServiceTest {

    private KbLibraryRepository libraryRepository;
    private KbDocumentRepository documentRepository;
    private NodeAdminResolver nodeAdminResolver;
    private KnowledgeEnginePort enginePort;
    private KbRaptorService service;

    @BeforeEach
    void setUp() {
        libraryRepository = mock(KbLibraryRepository.class);
        documentRepository = mock(KbDocumentRepository.class);
        nodeAdminResolver = mock(NodeAdminResolver.class);
        enginePort = mock(KnowledgeEnginePort.class);
        service = new KbRaptorService(
                libraryRepository, documentRepository, nodeAdminResolver, enginePort);
    }

    /** 构造启用 + 有引擎映射的库，可自定义 RAPTOR 字段。 */
    private static KbLibrary enabledLibrary(Long id, boolean useRaptor, String raptorStatus) {
        KbLibrary lib = new KbLibrary();
        lib.setId(id);
        lib.setStatus(1);
        lib.setEngineType("ragflow");
        lib.setEngineLibraryRef("ds-" + id);
        RagSettings settings = new RagSettings(
                RagSettings.DEFAULT_TOP_K, RagSettings.DEFAULT_SCORE_THRESHOLD, Boolean.FALSE,
                null, RagSettings.DEFAULT_RETRIEVAL_METHOD, RagSettings.DEFAULT_CHUNK_METHOD,
                RagSettings.DEFAULT_CHUNK_TOKEN_NUM, null, null,
                RagSettings.DEFAULT_VECTOR_SIMILARITY_WEIGHT, null,
                Boolean.FALSE, RagSettings.DEFAULT_OCR_LANGUAGE, null,
                Boolean.FALSE, RagSettings.KG_STATUS_NONE, null,
                useRaptor, 1024, 0.1D, 64, null, raptorStatus, null);
        lib.setRagSettingsJson(KbJson.writeSettings(settings));
        return lib;
    }

    private void givenRaptorCapability(boolean supported) {
        EngineCapabilities caps = supported
                ? EngineCapabilities.of(true, true, true, true, true, false, false, false, true)
                : EngineCapabilities.unsupported();
        when(enginePort.capabilities()).thenReturn(caps);
    }

    // ------------------------------------------------------------ 构建触发：状态机

    @Test
    @DisplayName("happy path：前置全过 → 触发引擎建树 + 回写 building + 返回 taskId")
    void buildHappyPath() {
        KbLibrary lib = enabledLibrary(1L, true, RagSettings.RAPTOR_STATUS_NONE);
        when(libraryRepository.findById(1L)).thenReturn(Optional.of(lib));
        when(nodeAdminResolver.hasLibraryManage(7L, 1L)).thenReturn(true);
        givenRaptorCapability(true);
        when(documentRepository.countByLibraryId(1L)).thenReturn(5L);
        when(enginePort.buildRaptor(any(EngineLibraryRef.class))).thenReturn("task-abc");

        KbRaptorBuildResultVO result = service.build(1L, 7L);

        assertTrue(result.building());
        assertEquals("task-abc", result.taskId());
        assertEquals(RagSettings.RAPTOR_STATUS_BUILDING, result.raptorBuildStatus());
        verify(enginePort).buildRaptor(any(EngineLibraryRef.class));
        // 回写 building 到 rag_settings_json
        RagSettings saved = KbJson.readSettings(lib.getRagSettingsJson());
        assertEquals(RagSettings.RAPTOR_STATUS_BUILDING, saved.raptorBuildStatus());
    }

    @Test
    @DisplayName("building 态拒绝重复触发 → KB_RAPTOR_BUILD_IN_PROGRESS")
    void buildRejectedWhenAlreadyBuilding() {
        KbLibrary lib = enabledLibrary(1L, true, RagSettings.RAPTOR_STATUS_BUILDING);
        when(libraryRepository.findById(1L)).thenReturn(Optional.of(lib));
        when(nodeAdminResolver.hasLibraryManage(7L, 1L)).thenReturn(true);
        givenRaptorCapability(true);
        when(documentRepository.countByLibraryId(1L)).thenReturn(5L);

        KbBusinessException ex = assertThrows(KbBusinessException.class, () -> service.build(1L, 7L));
        assertEquals(KbResultCode.KB_RAPTOR_BUILD_IN_PROGRESS.getCode(), ex.getCode());
        verify(enginePort, never()).buildRaptor(any());
    }

    @Test
    @DisplayName("能力 false → KB_RAPTOR_UNSUPPORTED（三道防线第二道）")
    void buildRejectedWhenCapabilityMissing() {
        KbLibrary lib = enabledLibrary(1L, true, RagSettings.RAPTOR_STATUS_NONE);
        when(libraryRepository.findById(1L)).thenReturn(Optional.of(lib));
        when(nodeAdminResolver.hasLibraryManage(7L, 1L)).thenReturn(true);
        givenRaptorCapability(false);
        when(documentRepository.countByLibraryId(1L)).thenReturn(5L);

        KbBusinessException ex = assertThrows(KbBusinessException.class, () -> service.build(1L, 7L));
        assertEquals(KbResultCode.KB_RAPTOR_UNSUPPORTED.getCode(), ex.getCode());
        verify(enginePort, never()).buildRaptor(any());
    }

    @Test
    @DisplayName("库无引擎映射 → KB_RAPTOR_UNSUPPORTED（不空调引擎）")
    void buildRejectedWithoutEngineRef() {
        KbLibrary lib = enabledLibrary(1L, true, RagSettings.RAPTOR_STATUS_NONE);
        lib.setEngineLibraryRef(null);
        when(libraryRepository.findById(1L)).thenReturn(Optional.of(lib));
        when(nodeAdminResolver.hasLibraryManage(7L, 1L)).thenReturn(true);
        givenRaptorCapability(true);
        when(documentRepository.countByLibraryId(1L)).thenReturn(5L);

        KbBusinessException ex = assertThrows(KbBusinessException.class, () -> service.build(1L, 7L));
        assertEquals(KbResultCode.KB_RAPTOR_UNSUPPORTED.getCode(), ex.getCode());
        verify(enginePort, never()).buildRaptor(any());
    }

    @Test
    @DisplayName("库无文档 → KB_RAPTOR_UNSUPPORTED（引擎侧无 chunks 建树无意义）")
    void buildRejectedWithoutDocuments() {
        KbLibrary lib = enabledLibrary(1L, true, RagSettings.RAPTOR_STATUS_NONE);
        when(libraryRepository.findById(1L)).thenReturn(Optional.of(lib));
        when(nodeAdminResolver.hasLibraryManage(7L, 1L)).thenReturn(true);
        givenRaptorCapability(true);
        when(documentRepository.countByLibraryId(1L)).thenReturn(0L);

        KbBusinessException ex = assertThrows(KbBusinessException.class, () -> service.build(1L, 7L));
        assertEquals(KbResultCode.KB_RAPTOR_UNSUPPORTED.getCode(), ex.getCode());
        verify(enginePort, never()).buildRaptor(any());
    }

    // ------------------------------------------------------------ 状态刷新回写

    @Test
    @DisplayName("引擎 READY → 回写 ready + 清空 message")
    void refreshMapsReady() {
        KbLibrary lib = enabledLibrary(1L, true, RagSettings.RAPTOR_STATUS_BUILDING);
        when(libraryRepository.findById(1L)).thenReturn(Optional.of(lib));
        when(enginePort.queryRaptorBuildStatus(any(EngineLibraryRef.class)))
                .thenReturn(new RaptorBuildSnapshot("task-1", 1.0D,
                        RaptorBuildSnapshot.Status.READY, "22:54:51 done", 8852L));

        KbRaptorStatusVO vo = service.refreshStatus(1L);

        assertEquals(RagSettings.RAPTOR_STATUS_READY, vo.raptorBuildStatus());
        assertNull(vo.raptorBuildMessage(), "ready 必须清空 message（状态机 §10-10）");
        assertEquals("task-1", vo.raptorTaskId());
        RagSettings saved = KbJson.readSettings(lib.getRagSettingsJson());
        assertEquals(RagSettings.RAPTOR_STATUS_READY, saved.raptorBuildStatus());
        assertNull(saved.raptorBuildMessage());
    }

    @Test
    @DisplayName("引擎 FAILED → 回写 failed + 存 progress_msg 摘要")
    void refreshMapsFailed() {
        KbLibrary lib = enabledLibrary(1L, true, RagSettings.RAPTOR_STATUS_BUILDING);
        when(libraryRepository.findById(1L)).thenReturn(Optional.of(lib));
        when(enginePort.queryRaptorBuildStatus(any(EngineLibraryRef.class)))
                .thenReturn(new RaptorBuildSnapshot("task-2", -1.0D,
                        RaptorBuildSnapshot.Status.FAILED, "No documents", 1000L));

        KbRaptorStatusVO vo = service.refreshStatus(1L);

        assertEquals(RagSettings.RAPTOR_STATUS_FAILED, vo.raptorBuildStatus());
        assertEquals("No documents", vo.raptorBuildMessage());
    }

    @Test
    @DisplayName("引擎 BUILDING → 回写 building + 可存 progress_msg")
    void refreshMapsBuilding() {
        KbLibrary lib = enabledLibrary(1L, true, RagSettings.RAPTOR_STATUS_NONE);
        when(libraryRepository.findById(1L)).thenReturn(Optional.of(lib));
        when(enginePort.queryRaptorBuildStatus(any(EngineLibraryRef.class)))
                .thenReturn(new RaptorBuildSnapshot("task-3", 0.4D,
                        RaptorBuildSnapshot.Status.BUILDING, "22:54:50 received", null));

        KbRaptorStatusVO vo = service.refreshStatus(1L);

        assertEquals(RagSettings.RAPTOR_STATUS_BUILDING, vo.raptorBuildStatus());
        assertEquals("22:54:50 received", vo.raptorBuildMessage());
    }

    @Test
    @DisplayName("引擎 NONE（无任务）→ 保留本地值（R6 漂移防线），不写库")
    void refreshKeepsLocalOnNone() {
        KbLibrary lib = enabledLibrary(1L, true, RagSettings.RAPTOR_STATUS_READY);
        when(libraryRepository.findById(1L)).thenReturn(Optional.of(lib));
        when(enginePort.queryRaptorBuildStatus(any(EngineLibraryRef.class)))
                .thenReturn(RaptorBuildSnapshot.none());

        KbRaptorStatusVO vo = service.refreshStatus(1L);

        assertEquals(RagSettings.RAPTOR_STATUS_READY, vo.raptorBuildStatus(),
                "NONE 时保留本地 ready，不因引擎无任务把状态清掉");
        assertNull(vo.raptorTaskId());
    }

    @Test
    @DisplayName("引擎 FAILED progress_msg 超 200 → 截断（raptorBuildMessage ≤200 约束）")
    void refreshTruncatesLongMessage() {
        KbLibrary lib = enabledLibrary(1L, true, RagSettings.RAPTOR_STATUS_BUILDING);
        when(libraryRepository.findById(1L)).thenReturn(Optional.of(lib));
        String longMsg = "x".repeat(500);
        when(enginePort.queryRaptorBuildStatus(any(EngineLibraryRef.class)))
                .thenReturn(new RaptorBuildSnapshot("task-4", -1.0D,
                        RaptorBuildSnapshot.Status.FAILED, longMsg, 1000L));

        KbRaptorStatusVO vo = service.refreshStatus(1L);

        assertEquals(200, vo.raptorBuildMessage().length());
    }
}
