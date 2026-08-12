package com.mis.kb.domain.service;

import com.mis.kb.api.dto.KbGraphBuildResultVO;
import com.mis.kb.api.dto.KbGraphStatusVO;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.EngineCapabilities;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.GraphBuildSnapshot;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.engine.RagflowProperties;
import com.mis.kb.support.KbBusinessException;
import com.mis.kb.support.KbJson;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
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
 * KbGraphService 上限校验 + 状态机测试（Wave B GraphRAG PoC，T04）。
 *
 * <p>锁定设计 §2.1/§2.3 与共享知识 §10-10：
 * <ol>
 *   <li><b>上限（U7）</b>：{@code useKnowledgeGraph=true} 的启用库数 ≥
 *       {@code mis.kb.engine.graph-max-libraries}（默认 2）→ {@code KB_GRAPH_LIBRARY_LIMIT}；
 *       保存与构图两处共用 {@link KbGraphService#canEnableGraph}；</li>
 *   <li><b>状态机</b>：{@code none → building → ready|failed →（重试）building}；
 *       {@code building} 拒绝重复触发（{@code KB_GRAPH_BUILD_IN_PROGRESS}）；
 *       {@code ready} 清 {@code kgBuildMessage}；</li>
 *   <li><b>刷新回写</b>：引擎 READY/FAILED/BUILDING 映射写库；NONE（无任务）保留本地（R6）。</li>
 * </ol>
 */
class KbGraphServiceTest {

    private KbLibraryRepository libraryRepository;
    private KbDocumentRepository documentRepository;
    private NodeAdminResolver nodeAdminResolver;
    private KnowledgeEnginePort enginePort;
    private RagflowProperties props;
    private KbGraphService service;

    @BeforeEach
    void setUp() {
        libraryRepository = mock(KbLibraryRepository.class);
        documentRepository = mock(KbDocumentRepository.class);
        nodeAdminResolver = mock(NodeAdminResolver.class);
        enginePort = mock(KnowledgeEnginePort.class);
        props = new RagflowProperties();
        service = new KbGraphService(
                libraryRepository, documentRepository, nodeAdminResolver, enginePort, props);
    }

    /** 构造启用 + 有引擎映射的库，可自定义图谱字段。 */
    private static KbLibrary enabledLibrary(Long id, boolean useKg, String kgStatus) {
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
                useKg, kgStatus, null);
        lib.setRagSettingsJson(KbJson.writeSettings(settings));
        return lib;
    }

    private void givenGraphCapability(boolean supported) {
        EngineCapabilities caps = supported
                ? EngineCapabilities.of(true, true, true, true, true, false, false, true)
                : EngineCapabilities.unsupported();
        when(enginePort.capabilities()).thenReturn(caps);
    }

    // ------------------------------------------------------------ 构图触发：状态机

    @Test
    @DisplayName("happy path：前置全过 → 触发引擎构图 + 回写 building + 返回 taskId")
    void buildHappyPath() {
        KbLibrary lib = enabledLibrary(1L, true, RagSettings.KG_STATUS_NONE);
        when(libraryRepository.findById(1L)).thenReturn(Optional.of(lib));
        when(nodeAdminResolver.hasLibraryManage(7L, 1L)).thenReturn(true);
        givenGraphCapability(true);
        when(documentRepository.countByLibraryId(1L)).thenReturn(5L);
        when(enginePort.buildGraph(any(EngineLibraryRef.class))).thenReturn("task-abc");

        KbGraphBuildResultVO result = service.build(1L, 7L);

        assertTrue(result.building());
        assertEquals("task-abc", result.taskId());
        assertEquals(RagSettings.KG_STATUS_BUILDING, result.kgBuildStatus());
        verify(enginePort).buildGraph(any(EngineLibraryRef.class));
        // 回写 building 到 rag_settings_json
        RagSettings saved = KbJson.readSettings(lib.getRagSettingsJson());
        assertEquals(RagSettings.KG_STATUS_BUILDING, saved.kgBuildStatus());
    }

    @Test
    @DisplayName("building 态拒绝重复触发 → KB_GRAPH_BUILD_IN_PROGRESS")
    void buildRejectedWhenAlreadyBuilding() {
        KbLibrary lib = enabledLibrary(1L, true, RagSettings.KG_STATUS_BUILDING);
        when(libraryRepository.findById(1L)).thenReturn(Optional.of(lib));
        when(nodeAdminResolver.hasLibraryManage(7L, 1L)).thenReturn(true);
        givenGraphCapability(true);
        when(documentRepository.countByLibraryId(1L)).thenReturn(5L);

        KbBusinessException ex = assertThrows(KbBusinessException.class, () -> service.build(1L, 7L));
        assertEquals(KbResultCode.KB_GRAPH_BUILD_IN_PROGRESS.getCode(), ex.getCode());
        verify(enginePort, never()).buildGraph(any());
    }

    @Test
    @DisplayName("能力 false → KB_GRAPH_UNSUPPORTED（三道防线第二道）")
    void buildRejectedWhenCapabilityMissing() {
        KbLibrary lib = enabledLibrary(1L, true, RagSettings.KG_STATUS_NONE);
        when(libraryRepository.findById(1L)).thenReturn(Optional.of(lib));
        when(nodeAdminResolver.hasLibraryManage(7L, 1L)).thenReturn(true);
        givenGraphCapability(false);
        when(documentRepository.countByLibraryId(1L)).thenReturn(5L);

        KbBusinessException ex = assertThrows(KbBusinessException.class, () -> service.build(1L, 7L));
        assertEquals(KbResultCode.KB_GRAPH_UNSUPPORTED.getCode(), ex.getCode());
        verify(enginePort, never()).buildGraph(any());
    }

    // ------------------------------------------------------------ 上限校验（U7）

    @Test
    @DisplayName("已达上限（2 库开启，max=2）→ 第 3 个库 KB_GRAPH_LIBRARY_LIMIT")
    void canEnableGraphRejectsAtLimit() {
        props.setGraphMaxLibraries(2);
        KbLibrary libA = enabledLibrary(1L, true, RagSettings.KG_STATUS_READY);
        KbLibrary libB = enabledLibrary(2L, true, RagSettings.KG_STATUS_READY);
        KbLibrary target = enabledLibrary(3L, false, RagSettings.KG_STATUS_NONE);
        // findAll 返回三库；目标库（3L）不计入已用额度
        when(libraryRepository.findAll()).thenReturn(List.of(libA, libB, target));

        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> service.canEnableGraph(3L));
        assertEquals(KbResultCode.KB_GRAPH_LIBRARY_LIMIT.getCode(), ex.getCode());
        assertTrue(ex.getMessage().contains("2"), "错误信息应带上限值，实际：" + ex.getMessage());
    }

    @Test
    @DisplayName("未达上限（1 库开启，max=2）→ 放行；目标库本身开关不计入额度")
    void canEnableGraphPassesUnderLimit() {
        props.setGraphMaxLibraries(2);
        KbLibrary libA = enabledLibrary(1L, true, RagSettings.KG_STATUS_READY);
        KbLibrary target = enabledLibrary(2L, true, RagSettings.KG_STATUS_NONE);
        when(libraryRepository.findAll()).thenReturn(List.of(libA, target));

        // 不抛异常即通过
        service.canEnableGraph(2L);
    }

    @Test
    @DisplayName("停用/归档库不占额度（只统计 status=enabled 且开关为真的库）")
    void canEnableGraphIgnoresDisabledLibraries() {
        props.setGraphMaxLibraries(2);
        KbLibrary libA = enabledLibrary(1L, true, RagSettings.KG_STATUS_READY);
        KbLibrary libB = enabledLibrary(2L, true, RagSettings.KG_STATUS_READY);
        libB.setStatus(0); // 停用：不占额度
        KbLibrary target = enabledLibrary(3L, false, RagSettings.KG_STATUS_NONE);
        when(libraryRepository.findAll()).thenReturn(List.of(libA, libB, target));

        service.canEnableGraph(3L); // 实际只算 libA 1 个 < 2 → 放行
    }

    // ------------------------------------------------------------ 状态刷新回写

    @Test
    @DisplayName("引擎 READY → 回写 ready + 清空 message")
    void refreshMapsReady() {
        KbLibrary lib = enabledLibrary(1L, true, RagSettings.KG_STATUS_BUILDING);
        when(libraryRepository.findById(1L)).thenReturn(Optional.of(lib));
        when(enginePort.queryGraphBuildStatus(any(EngineLibraryRef.class)))
                .thenReturn(new GraphBuildSnapshot("task-1", 1.0D,
                        GraphBuildSnapshot.Status.READY, "22:54:51 done", 8852L));

        KbGraphStatusVO vo = service.refreshStatus(1L);

        assertEquals(RagSettings.KG_STATUS_READY, vo.kgBuildStatus());
        assertNull(vo.kgBuildMessage(), "ready 必须清空 message（状态机 §10-10）");
        assertEquals("task-1", vo.graphragTaskId());
        RagSettings saved = KbJson.readSettings(lib.getRagSettingsJson());
        assertEquals(RagSettings.KG_STATUS_READY, saved.kgBuildStatus());
        assertNull(saved.kgBuildMessage());
    }

    @Test
    @DisplayName("引擎 FAILED → 回写 failed + 存 progress_msg 摘要")
    void refreshMapsFailed() {
        KbLibrary lib = enabledLibrary(1L, true, RagSettings.KG_STATUS_BUILDING);
        when(libraryRepository.findById(1L)).thenReturn(Optional.of(lib));
        when(enginePort.queryGraphBuildStatus(any(EngineLibraryRef.class)))
                .thenReturn(new GraphBuildSnapshot("task-2", -1.0D,
                        GraphBuildSnapshot.Status.FAILED, "No documents", 1000L));

        KbGraphStatusVO vo = service.refreshStatus(1L);

        assertEquals(RagSettings.KG_STATUS_FAILED, vo.kgBuildStatus());
        assertEquals("No documents", vo.kgBuildMessage());
    }

    @Test
    @DisplayName("引擎 BUILDING → 回写 building + 可存 progress_msg")
    void refreshMapsBuilding() {
        KbLibrary lib = enabledLibrary(1L, true, RagSettings.KG_STATUS_NONE);
        when(libraryRepository.findById(1L)).thenReturn(Optional.of(lib));
        when(enginePort.queryGraphBuildStatus(any(EngineLibraryRef.class)))
                .thenReturn(new GraphBuildSnapshot("task-3", 0.4D,
                        GraphBuildSnapshot.Status.BUILDING, "22:54:50 received", null));

        KbGraphStatusVO vo = service.refreshStatus(1L);

        assertEquals(RagSettings.KG_STATUS_BUILDING, vo.kgBuildStatus());
        assertEquals("22:54:50 received", vo.kgBuildMessage());
    }

    @Test
    @DisplayName("引擎 NONE（无任务）→ 保留本地值（R6 漂移防线），不写库")
    void refreshKeepsLocalOnNone() {
        KbLibrary lib = enabledLibrary(1L, true, RagSettings.KG_STATUS_READY);
        when(libraryRepository.findById(1L)).thenReturn(Optional.of(lib));
        when(enginePort.queryGraphBuildStatus(any(EngineLibraryRef.class)))
                .thenReturn(GraphBuildSnapshot.none());

        KbGraphStatusVO vo = service.refreshStatus(1L);

        assertEquals(RagSettings.KG_STATUS_READY, vo.kgBuildStatus(),
                "NONE 时保留本地 ready，不因引擎无任务把状态清掉");
        assertNull(vo.graphragTaskId());
    }
}
