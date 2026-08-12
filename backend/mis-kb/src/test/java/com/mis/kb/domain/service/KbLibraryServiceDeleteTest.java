package com.mis.kb.domain.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.kb.api.dto.KbLibraryDeleteResultVO;
import com.mis.kb.api.dto.KbLibraryUpdateRequest;
import com.mis.kb.api.dto.KbLibraryVO;
import com.mis.kb.domain.entity.KbAcl;
import com.mis.kb.domain.entity.KbCategory;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.EngineSyncStatus;
import com.mis.kb.domain.model.LibraryDeleteMode;
import com.mis.kb.domain.model.LibraryStatus;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.repository.KbAclRepository;
import com.mis.kb.domain.repository.KbCategoryRepository;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.engine.RagflowDatasetNaming;
import com.mis.kb.engine.RagflowProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 知识库删除三分支 + update 回执单测（引擎删除策略 P0 / T03 验收点 1–3）。
 *
 * <p><b>这是本次 P0 最该被测的一块</b>：旧实现 {@code delete()} 把引擎异常 catch 掉后
 * 照样删本地，产生「MIS 显示删成功、RAGFlow 侧 dataset 还在」的假成功，正是本次事故根因。
 * 下面四条用例分别钉死四种结局，任何一条被改回「吞异常」都会立刻挂。
 *
 * <p>用 Mockito 纯单测而非 {@code @SpringBootTest}：与 mis-kb 既有测试风格一致
 * （本模块零 Spring 容器测试），且事务回滚语义靠「不曾发生任何写操作」来断言——
 * 比起真起容器测 rollback，这个断言更直接也更快。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("T03 知识库删除三分支")
class KbLibraryServiceDeleteTest {

    private static final long LIBRARY_ID = 1_954_321_987_654_321L;
    private static final long CATEGORY_ID = 700L;
    /** KBP-06：delete/update 保存路径新增的 userId 参数（可测性优先，Service 不读线程上下文）。 */
    private static final long USER_ID = 7L;
    private static final String DATASET_ID = "rf-dataset-abc";

    @Mock
    private KbLibraryRepository libraryRepository;
    @Mock
    private KbDocumentRepository documentRepository;
    @Mock
    private KbAclRepository aclRepository;
    @Mock
    private KbCategoryRepository categoryRepository;
    @Mock
    private KnowledgeEnginePort enginePort;
    @Mock
    private NodeAdminResolver nodeAdminResolver;
    /** KBP-06：list(scope=visible) 分支依赖（mock，本测试不触发可见性解析）。 */
    @Mock
    private KbVisibilityService visibilityService;

    private RagflowProperties props;
    private KbLibraryService service;
    private KbLibrary library;

    @BeforeEach
    void setUp() {
        props = new RagflowProperties();
        props.setType("ragflow");
        props.setDeleteSupported(false);
        service = new KbLibraryService(libraryRepository, documentRepository, aclRepository,
                categoryRepository, enginePort, props, nodeAdminResolver, visibilityService);

        library = new KbLibrary();
        library.setId(LIBRARY_ID);
        library.setCategoryId(CATEGORY_ID);
        library.setName("报销制度");
        library.setSecrecy("internal");
        library.setStatus(LibraryStatus.ENABLED.code());
        library.setEngineType("ragflow");
        library.setEngineLibraryRef(DATASET_ID);
        library.setEngineSyncStatus(EngineSyncStatus.UNKNOWN);

        KbCategory category = new KbCategory();
        category.setId(CATEGORY_ID);
        category.setName("财务");
        category.setParentId(0L);

        when(libraryRepository.findById(LIBRARY_ID)).thenReturn(Optional.of(library));
        when(categoryRepository.findById(CATEGORY_ID)).thenReturn(Optional.of(category));
        when(libraryRepository.save(any(KbLibrary.class))).thenAnswer(inv -> inv.getArgument(0));
        when(documentRepository.countByLibraryId(anyLong())).thenReturn(7L);
        when(aclRepository.findByLibraryId(anyLong())).thenReturn(List.of(new KbAcl(), new KbAcl()));
        // KBP-06：默认放行「可管理」判定——既有用例聚焦删除/归档/回执语义，不受管辖分支干扰；
        // 越权负分支（create/update/delete 非管理 → 40311）在 KbLibraryServiceManageGateTest 单独钉死
        when(nodeAdminResolver.hasLibraryManage(eq(USER_ID), eq(LIBRARY_ID))).thenReturn(true);
    }

    // ------------------------------------------------------------------ physical

    @Nested
    @DisplayName("physical 分支")
    class Physical {

        @Test
        @DisplayName("引擎不支持删除 → 抛 40934，库行仍在，引擎与三表零接触")
        void shouldRejectWhenDeleteUnsupported() {
            props.setDeleteSupported(false);

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> service.delete(USER_ID, LIBRARY_ID, LibraryDeleteMode.PHYSICAL));

            assertEquals(40934, ex.getCode());
            verify(enginePort, never()).deleteLibrary(any());
            verify(libraryRepository, never()).delete(any());
            verify(documentRepository, never()).deleteByLibraryId(anyLong());
            verify(aclRepository, never()).deleteByLibraryId(anyLong());
            verify(libraryRepository, never()).save(any());
        }

        @Test
        @DisplayName("引擎删除抛异常 → 抛 40935，kb_document/kb_acl/kb_library 三表零变更")
        void shouldRollbackWhenEngineDeleteFails() {
            props.setDeleteSupported(true);
            doThrow(new IllegalStateException("RAGFlow 502"))
                    .when(enginePort).deleteLibrary(any(EngineLibraryRef.class));

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> service.delete(USER_ID, LIBRARY_ID, LibraryDeleteMode.PHYSICAL));

            assertEquals(40935, ex.getCode());
            assertTrue(ex.getMessage().contains("RAGFlow 502"),
                    "回执要带上引擎原因，否则运维只能去翻日志");
            // 关键：异常必须上抛让 @Transactional 回滚，绝不能 catch 后继续删本地
            verify(documentRepository, never()).deleteByLibraryId(anyLong());
            verify(aclRepository, never()).deleteByLibraryId(anyLong());
            verify(libraryRepository, never()).delete(any());
        }

        @Test
        @DisplayName("引擎删除成功 → 三表按 文档→授权→库 顺序清干净（回归 Q6 悬空文档）")
        void shouldCleanAllThreeTables() {
            props.setDeleteSupported(true);

            KbLibraryDeleteResultVO result = service.delete(USER_ID, LIBRARY_ID, LibraryDeleteMode.PHYSICAL);

            verify(enginePort).deleteLibrary(any(EngineLibraryRef.class));
            verify(documentRepository).deleteByLibraryId(LIBRARY_ID);
            verify(aclRepository).deleteByLibraryId(LIBRARY_ID);
            verify(libraryRepository).delete(library);

            assertEquals("physical", result.mode());
            assertTrue(result.engineSynced());
            assertNull(result.engineError());
            assertEquals(7L, result.docCleaned(), "Q6：悬空文档必须被清并如实回报条数");
            assertEquals(2L, result.aclCleaned());
        }

        @Test
        @DisplayName("未绑定引擎 dataset 的库允许物理删除（不因 ref 为空卡死）")
        void shouldDeleteLocalOnlyLibrary() {
            props.setDeleteSupported(true);
            library.setEngineLibraryRef(null);

            KbLibraryDeleteResultVO result = service.delete(USER_ID, LIBRARY_ID, LibraryDeleteMode.PHYSICAL);

            verify(enginePort, never()).deleteLibrary(any());
            verify(libraryRepository).delete(library);
            assertTrue(result.engineSynced());
        }
    }

    // ------------------------------------------------------------------ archive

    @Nested
    @DisplayName("archive 分支")
    class Archive {

        @Test
        @DisplayName("成功：status=0 + archived_at 非空 + 引擎收到归档名 rename")
        void shouldArchiveAndRename() {
            KbLibraryDeleteResultVO result = service.delete(USER_ID, LIBRARY_ID, LibraryDeleteMode.ARCHIVE);

            ArgumentCaptor<String> nameCaptor = ArgumentCaptor.forClass(String.class);
            verify(enginePort).renameLibrary(any(EngineLibraryRef.class), nameCaptor.capture());
            assertTrue(RagflowDatasetNaming.isArchivedName(nameCaptor.getValue()),
                    "下发给引擎的必须是带 [已归档-yyyyMMdd]- 前缀的名字，实际=" + nameCaptor.getValue());
            assertTrue(nameCaptor.getValue().endsWith("财务-报销制度-654321"),
                    "归档名应基于命名规范算出的期望名");

            assertEquals(LibraryStatus.DISABLED.code(), library.getStatus());
            assertNotNull(library.getArchivedAt(), "archived_at 是区分「停用」与「归档」的唯一标记");
            assertTrue(library.isArchived());
            assertEquals(EngineSyncStatus.CONSISTENT, library.getEngineSyncStatus());
            assertNotNull(library.getEngineCheckedAt());
            verify(libraryRepository).save(library);

            assertEquals("archive", result.mode());
            assertTrue(result.engineSynced());
            assertNotNull(result.archivedName());
            assertTrue(result.message().contains("未删除引擎数据"),
                    "§1.10-2：破坏性语义变更必须在回执里说清楚");
        }

        @Test
        @DisplayName("归档不清文档、不清授权（Q6）")
        void shouldNotTouchDocumentsOrAcl() {
            KbLibraryDeleteResultVO result = service.delete(USER_ID, LIBRARY_ID, LibraryDeleteMode.ARCHIVE);

            verify(documentRepository, never()).deleteByLibraryId(anyLong());
            verify(aclRepository, never()).deleteByLibraryId(anyLong());
            verify(libraryRepository, never()).delete(any());
            assertEquals(0L, result.docCleaned());
            assertEquals(0L, result.aclCleaned());
        }

        @Test
        @DisplayName("引擎 rename 失败 → 归档仍成功，engineSynced=false + engine_sync_status=3")
        void shouldArchiveEvenWhenRenameFails() {
            doThrow(new IllegalStateException("connect timed out"))
                    .when(enginePort).renameLibrary(any(EngineLibraryRef.class), anyString());

            KbLibraryDeleteResultVO result = service.delete(USER_ID, LIBRARY_ID, LibraryDeleteMode.ARCHIVE);

            assertFalse(result.engineSynced());
            assertEquals("connect timed out", result.engineError());
            assertNull(result.archivedName(), "改名没成，就不该谎报归档名");
            assertTrue(result.message().contains("待对账"));
            // 本地归档照做
            assertEquals(LibraryStatus.DISABLED.code(), library.getStatus());
            assertNotNull(library.getArchivedAt());
            assertEquals(EngineSyncStatus.DRIFT_OR_FAILED, library.getEngineSyncStatus(),
                    "失败必须落 3，否则对账看不见这条");
            assertNotNull(library.getEngineCheckedAt());
            verify(libraryRepository).save(library);
        }

        @Test
        @DisplayName("库未绑定引擎 → 跳过引擎调用，本地照常归档")
        void shouldArchiveUnboundLibrary() {
            library.setEngineLibraryRef(null);

            KbLibraryDeleteResultVO result = service.delete(USER_ID, LIBRARY_ID, LibraryDeleteMode.ARCHIVE);

            verify(enginePort, never()).renameLibrary(any(), anyString());
            assertTrue(result.engineSynced());
            assertEquals(LibraryStatus.DISABLED.code(), library.getStatus());
            assertNotNull(library.getArchivedAt());
            assertTrue(result.message().contains("未删除引擎数据"));
        }

        @Test
        @DisplayName("MIS 侧 name 绝不改（改了会撞 (name, category_id) 唯一键）")
        void shouldNotRenameLocalLibrary() {
            service.delete(USER_ID, LIBRARY_ID, LibraryDeleteMode.ARCHIVE);

            assertEquals("报销制度", library.getName());
        }

        @Test
        @DisplayName("重复归档幂等：第二次下发的名字不产生双前缀")
        void shouldBeIdempotentOnRepeatedArchive() {
            service.delete(USER_ID, LIBRARY_ID, LibraryDeleteMode.ARCHIVE);
            service.delete(USER_ID, LIBRARY_ID, LibraryDeleteMode.ARCHIVE);

            ArgumentCaptor<String> nameCaptor = ArgumentCaptor.forClass(String.class);
            verify(enginePort, times(2)).renameLibrary(any(EngineLibraryRef.class), nameCaptor.capture());
            for (String sent : nameCaptor.getAllValues()) {
                assertFalse(sent.replaceFirst("^\\[已归档-\\d{8}]-", "").contains("[已归档-"),
                        "重试归档不得叠加第二层前缀，实际=" + sent);
            }
        }
    }

    // ------------------------------------------------------------------ 默认模式 / 边界

    @Nested
    @DisplayName("模式解析与边界")
    class ModeResolution {

        @Test
        @DisplayName("mode=null → 默认走归档（破坏性语义变更的落点）")
        void shouldDefaultToArchive() {
            KbLibraryDeleteResultVO result = service.delete(USER_ID, LIBRARY_ID, null);

            assertEquals("archive", result.mode());
            verify(enginePort).renameLibrary(any(EngineLibraryRef.class), anyString());
            verify(enginePort, never()).deleteLibrary(any());
            verify(libraryRepository, never()).delete(any());
        }

        @Test
        @DisplayName("LibraryDeleteMode.parse：空/空白→archive，合法值原样，非法值→null 由上层拒")
        void shouldParseWireValues() {
            assertEquals(LibraryDeleteMode.ARCHIVE, LibraryDeleteMode.parse(null));
            assertEquals(LibraryDeleteMode.ARCHIVE, LibraryDeleteMode.parse("  "));
            assertEquals(LibraryDeleteMode.ARCHIVE, LibraryDeleteMode.parse("archive"));
            assertEquals(LibraryDeleteMode.PHYSICAL, LibraryDeleteMode.parse("PHYSICAL"));
            assertEquals(LibraryDeleteMode.PHYSICAL, LibraryDeleteMode.parse(" physical "));
            assertNull(LibraryDeleteMode.parse("physicial"),
                    "拼错必须拒，静默回落归档会让用户以为自己删掉了");
            assertNull(LibraryDeleteMode.parse("force_unbind"));
        }

        @Test
        @DisplayName("库不存在 → 抛 40401，不触碰引擎")
        void shouldRejectMissingLibrary() {
            when(libraryRepository.findById(999L)).thenReturn(Optional.empty());

            assertThrows(BusinessException.class,
                    () -> service.delete(USER_ID, 999L, LibraryDeleteMode.ARCHIVE));
            verifyNoInteractions(enginePort);
        }
    }

    // ------------------------------------------------------------------ update 回执

    @Nested
    @DisplayName("update() 引擎同步回执（T03 验收点 2）")
    class UpdateSyncReceipt {

        private final RagSettings changed = new RagSettings(
                9, 0.5D, Boolean.FALSE, null, "hybrid", "naive", 256, null, null, 0.4D, null);

        @Test
        @DisplayName("引擎同步失败 → 不抛异常、库仍保存、VO 带 engineSyncFailed=true、DB 落 3")
        void shouldSurfaceSyncFailure() {
            library.setRagSettingsJson("{\"topK\":5}");
            doThrow(new IllegalStateException("RAGFlow 400 code:101"))
                    .when(enginePort).updateLibrarySettings(any(EngineLibraryRef.class), any());

            KbLibraryVO vo = service.update(USER_ID, LIBRARY_ID,
                    new KbLibraryUpdateRequest("报销制度", "internal", null, changed));

            assertEquals(Boolean.TRUE, vo.engineSyncFailed(), "静默失败正是本次要修的病");
            assertNotNull(vo.engineSyncMessage());
            assertTrue(vo.engineSyncMessage().contains("RAGFlow 400 code:101"));
            assertEquals(EngineSyncStatus.DRIFT_OR_FAILED, library.getEngineSyncStatus());
            assertNotNull(library.getEngineCheckedAt());
            verify(libraryRepository, times(2)).save(library);
        }

        @Test
        @DisplayName("引擎同步成功 → engineSyncFailed 恒 null（前端据此不弹黄条）")
        void shouldReturnCleanVoOnSuccess() {
            library.setRagSettingsJson("{\"topK\":5}");

            KbLibraryVO vo = service.update(USER_ID, LIBRARY_ID,
                    new KbLibraryUpdateRequest("报销制度", "internal", null, changed));

            assertNull(vo.engineSyncFailed());
            assertNull(vo.engineSyncMessage());
            verify(enginePort).updateLibrarySettings(any(EngineLibraryRef.class), any());
        }

        @Test
        @DisplayName("设置未变时不打引擎（省一次无谓 HTTP，也避免无端刷同步状态）")
        void shouldSkipEngineWhenSettingsUnchanged() {
            KbLibraryVO first = service.update(USER_ID, LIBRARY_ID,
                    new KbLibraryUpdateRequest("报销制度", "internal", null, changed));
            assertNotNull(first);

            // 第二次提交同样的 settings：json 与库里已存的一致 → 不应再调引擎
            service.update(USER_ID, LIBRARY_ID,
                    new KbLibraryUpdateRequest("报销制度", "internal", null, changed));

            verify(enginePort, times(1)).updateLibrarySettings(any(EngineLibraryRef.class), any());
        }
    }

    // ------------------------------------------------------------------ 取消归档回滚（P1-T2）

    @Nested
    @DisplayName("取消归档回滚（P1-T2）")
    class UnarchiveRollback {

        /** 把公共 fixture 置为「归档态」：status=0 且 archived_at 非空。 */
        private void makeArchived() {
            library.setStatus(LibraryStatus.DISABLED.code());
            library.setArchivedAt(Instant.now().minus(30, ChronoUnit.DAYS));
        }

        @Test
        @DisplayName("归档→恢复启用且引擎改名成功：archived_at 清空、engine_sync_status=1、引擎收到规范名")
        void shouldRestoreAndRenameOnUnarchive() {
            makeArchived();

            KbLibraryVO vo = service.update(USER_ID, LIBRARY_ID,
                    new KbLibraryUpdateRequest("报销制度", "internal", LibraryStatus.ENABLED.code(), null));

            assertNull(vo.engineSyncFailed(), "改名成功不应带失败回执");
            assertNull(library.getArchivedAt(), "取消归档必须清掉 archived_at");
            assertEquals(LibraryStatus.ENABLED.code(), library.getStatus());
            assertEquals(EngineSyncStatus.CONSISTENT, library.getEngineSyncStatus());
            verify(enginePort).renameLibrary(
                    new EngineLibraryRef("ragflow", DATASET_ID), "财务-报销制度-654321");
        }

        @Test
        @DisplayName("恢复时引擎改名失败：本地照常恢复、archived_at 清空、engine_sync_status=3、VO 带 engineSyncFailed")
        void shouldRestoreEvenWhenRenameFails() {
            makeArchived();
            doThrow(new IllegalStateException("RAGFlow 500"))
                    .when(enginePort).renameLibrary(any(EngineLibraryRef.class), anyString());

            KbLibraryVO vo = service.update(USER_ID, LIBRARY_ID,
                    new KbLibraryUpdateRequest("报销制度", "internal", LibraryStatus.ENABLED.code(), null));

            assertEquals(Boolean.TRUE, vo.engineSyncFailed(), "改名失败必须回执给前端");
            assertNull(library.getArchivedAt(), "改名失败不阻断取消归档（本地语义优先，与 P0 archive 一致）");
            assertEquals(LibraryStatus.ENABLED.code(), library.getStatus());
            assertEquals(EngineSyncStatus.DRIFT_OR_FAILED, library.getEngineSyncStatus());
            assertNotNull(library.getEngineCheckedAt());
        }

        @Test
        @DisplayName("普通停用（archivedAt=null）改启用不触发改名")
        void shouldNotRenameWhenNotArchived() {
            library.setStatus(LibraryStatus.DISABLED.code());
            library.setArchivedAt(null);

            service.update(USER_ID, LIBRARY_ID,
                    new KbLibraryUpdateRequest("报销制度", "internal", LibraryStatus.ENABLED.code(), null));

            verify(enginePort, never()).renameLibrary(any(), any());
            assertEquals(LibraryStatus.ENABLED.code(), library.getStatus());
        }

        @Test
        @DisplayName("归档中只改密级不改状态：不触发回滚、archived_at 不变")
        void shouldNotTouchArchivedWhenStatusUnchanged() {
            makeArchived();

            service.update(USER_ID, LIBRARY_ID,
                    new KbLibraryUpdateRequest("报销制度", "secret", null, null));

            verify(enginePort, never()).renameLibrary(any(), any());
            assertEquals(LibraryStatus.DISABLED.code(), library.getStatus());
            assertNotNull(library.getArchivedAt(), "不改状态就不该动归档标记");
        }
    }

    // ------------------------------------------------------------------ engineRef / 期望名

    @Nested
    @DisplayName("engineRef 与期望名")
    class EngineRefAndExpectedName {

        @Test
        @DisplayName("engineRef 如实返回 dataset_id 与同步状态（Q4 有限暴露，判权在 BFF）")
        void shouldExposeEngineRef() {
            library.setEngineSyncStatus(EngineSyncStatus.MISSING_IN_ENGINE);

            var vo = service.engineRef(LIBRARY_ID);

            assertEquals(LIBRARY_ID, vo.libraryId());
            assertEquals("ragflow", vo.engineType());
            assertEquals(DATASET_ID, vo.engineLibraryRef());
            assertEquals(EngineSyncStatus.MISSING_IN_ENGINE, vo.engineSyncStatus());
        }

        @Test
        @DisplayName("expectedEngineName 走命名规范；分类查不到时回落「未分类」")
        void shouldComputeExpectedName() {
            assertEquals("财务-报销制度-654321", service.expectedEngineName(library));

            when(categoryRepository.findById(CATEGORY_ID)).thenReturn(Optional.empty());
            assertEquals("未分类-报销制度-654321", service.expectedEngineName(library));
        }

        @Test
        @DisplayName("多级分类向上回溯到一级分类名")
        void shouldResolveTopCategory() {
            KbCategory child = new KbCategory();
            child.setId(701L);
            child.setName("报销");
            child.setParentId(CATEGORY_ID);
            when(categoryRepository.findById(701L)).thenReturn(Optional.of(child));

            assertEquals("财务", service.resolveTopCategoryName(701L));
        }

        @Test
        @DisplayName("分类成环时不死循环（脏数据防线）")
        void shouldSurviveCyclicCategory() {
            KbCategory a = new KbCategory();
            a.setId(801L);
            a.setName("A");
            a.setParentId(802L);
            KbCategory b = new KbCategory();
            b.setId(802L);
            b.setName("B");
            b.setParentId(801L);
            when(categoryRepository.findById(801L)).thenReturn(Optional.of(a));
            when(categoryRepository.findById(802L)).thenReturn(Optional.of(b));

            String top = service.resolveTopCategoryName(801L);

            assertTrue(top.equals("A") || top.equals("B"));
            verify(categoryRepository, times(16)).findById(anyLong());
        }

        @Test
        @DisplayName("categoryId 为 null → 未分类")
        void shouldFallbackNullCategory() {
            assertEquals(RagflowDatasetNaming.UNCATEGORIZED, service.resolveTopCategoryName(null));
            verify(categoryRepository, never()).findById(eq(null));
        }
    }
}
