package com.mis.kb.domain.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.kb.api.dto.KbLibraryDeleteResultVO;
import com.mis.kb.domain.entity.KbAcl;
import com.mis.kb.domain.entity.KbCategory;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.EngineSyncStatus;
import com.mis.kb.domain.model.LibraryDeleteMode;
import com.mis.kb.domain.model.LibraryStatus;
import com.mis.kb.domain.repository.KbAclRepository;
import com.mis.kb.domain.repository.KbCategoryRepository;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.EngineDatasetMissingException;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.engine.RagflowProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

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
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Q1「引擎侧 dataset 已不存在」两段式确认流的 service 级回归测试。
 *
 * <p><b>契约（架构师 Q2 裁决，逐条钉死）：</b>
 * <ul>
 *   <li>{@code force=false} + engineMissing → 返回提示态 VO（HTTP 200），
 *       <b>不执行任何本地变更</b>（无 repository 写操作）；</li>
 *   <li>{@code force=true} + engineMissing → 跳过引擎直接本地执行：
 *       物理删三表；归档本地停用 + 归档标记且 {@code engine_sync_status} 置
 *       {@code MISSING_IN_ENGINE(2)}（<b>不置 3</b>）+ {@code engineCheckedAt=now}；</li>
 *   <li>{@code force=true} 只对 engineMissing 生效：物理删除非 404 失败仍抛 40935 回滚；
 *       归档非 missing 改名失败仍 catch 待对账（engine_sync_status=3）；</li>
 *   <li>{@code force=true} 不豁免 {@code deleteSupported=false} 门控（仍抛 40934）；</li>
 *   <li>force 幂等：本地已不存在 + force=true → 幂等回执不报错；force=false 保持抛 not found；</li>
 *   <li>无 {@code engineLibraryRef} 不触发引擎检测（直接本地执行，不产生 engineMissing）。</li>
 * </ul>
 *
 * <p>用 Mockito 纯单测（与 {@code KbLibraryServiceDeleteTest} 同构），零 Spring 容器。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("Q1 引擎侧缺失两段式确认流")
class KbLibraryServiceEngineMissingTest {

    private static final long LIBRARY_ID = 1_954_321_987_654_321L;
    private static final long CATEGORY_ID = 700L;
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
    @Mock
    private KbVisibilityService visibilityService;

    private RagflowProperties props;
    private KbLibraryService service;
    private KbLibrary library;

    @BeforeEach
    void setUp() {
        props = new RagflowProperties();
        props.setType("ragflow");
        props.setDeleteSupported(true);
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
        when(nodeAdminResolver.hasLibraryManage(eq(USER_ID), eq(LIBRARY_ID))).thenReturn(true);
    }

    /** 引擎删除 → missing 信号。 */
    private void engineDeleteMissing() {
        doThrow(new EngineDatasetMissingException("RAGFlow 删除知识库失败: HTTP 404 引擎侧数据集不存在"))
                .when(enginePort).deleteLibrary(any(EngineLibraryRef.class));
    }

    /** 引擎改名 → missing 信号。 */
    private void engineRenameMissing() {
        doThrow(new EngineDatasetMissingException("RAGFlow 重命名知识库失败: HTTP 404 引擎侧数据集不存在"))
                .when(enginePort).renameLibrary(any(EngineLibraryRef.class), anyString());
    }

    // ---------------------------------------------------------------- physical

    @Nested
    @DisplayName("physical：两段式")
    class PhysicalMissing {

        @Test
        @DisplayName("force=false + missing → 提示态 VO（engineMissing=true），本地零变更")
        void promptStateWhenMissingAndNotForced() {
            engineDeleteMissing();

            KbLibraryDeleteResultVO vo = service.delete(USER_ID, LIBRARY_ID, LibraryDeleteMode.PHYSICAL, false);

            assertTrue(vo.engineMissing(), "提示态必须带 engineMissing=true");
            assertEquals("physical", vo.mode());
            assertEquals(0L, vo.docCleaned());
            assertEquals(0L, vo.aclCleaned());
            assertTrue(vo.message().contains("未做任何变更"),
                    "提示态文案必须明说本地零变更，实际=" + vo.message());
            // 本地零变更：无任何 repository 写操作
            verify(documentRepository, never()).deleteByLibraryId(anyLong());
            verify(aclRepository, never()).deleteByLibraryId(anyLong());
            verify(libraryRepository, never()).delete(any());
            verify(libraryRepository, never()).save(any());
        }

        @Test
        @DisplayName("force=true + missing → 跳过引擎直接删三表，回执 engineMissing=true")
        void skipEngineWhenMissingAndForced() {
            engineDeleteMissing();

            KbLibraryDeleteResultVO vo = service.delete(USER_ID, LIBRARY_ID, LibraryDeleteMode.PHYSICAL, true);

            assertTrue(vo.engineMissing());
            assertEquals(7L, vo.docCleaned());
            assertEquals(2L, vo.aclCleaned());
            assertTrue(vo.message().contains("跳过引擎"));
            // 引擎 deleteLibrary 仍然被调用过（missing 异常就是从它来的），但本地照删
            verify(enginePort).deleteLibrary(any(EngineLibraryRef.class));
            verify(documentRepository).deleteByLibraryId(LIBRARY_ID);
            verify(aclRepository).deleteByLibraryId(LIBRARY_ID);
            verify(libraryRepository).delete(library);
        }
    }

    // ---------------------------------------------------------------- archive

    @Nested
    @DisplayName("archive：两段式")
    class ArchiveMissing {

        @Test
        @DisplayName("force=false + missing → 提示态 VO，本地零变更（不落库）")
        void promptStateWhenMissingAndNotForced() {
            engineRenameMissing();

            KbLibraryDeleteResultVO vo = service.delete(USER_ID, LIBRARY_ID, LibraryDeleteMode.ARCHIVE, false);

            assertTrue(vo.engineMissing());
            assertEquals("archive", vo.mode());
            assertEquals(0L, vo.docCleaned());
            assertEquals(0L, vo.aclCleaned());
            assertTrue(vo.message().contains("未做任何变更"));
            verify(libraryRepository, never()).save(any());
            assertEquals(LibraryStatus.ENABLED.code(), library.getStatus(),
                    "提示态绝不允许把本地状态改成停用");
            assertNull(library.getArchivedAt(), "提示态绝不允许打归档标记");
        }

        @Test
        @DisplayName("force=true + missing → 跳过引擎直接本地归档，engine_sync_status 置 2（不置 3）+ engineCheckedAt=now")
        void skipEngineWhenMissingAndForced() {
            engineRenameMissing();

            KbLibraryDeleteResultVO vo = service.delete(USER_ID, LIBRARY_ID, LibraryDeleteMode.ARCHIVE, true);

            assertTrue(vo.engineMissing());
            assertTrue(vo.message().contains("跳过引擎"));
            assertEquals(LibraryStatus.DISABLED.code(), library.getStatus());
            assertNotNull(library.getArchivedAt());
            assertEquals(EngineSyncStatus.MISSING_IN_ENGINE, library.getEngineSyncStatus(),
                    "归档 force+missing 必须置 2（MISSING_IN_ENGINE），绝不能置 3 走待对账");
            assertNotNull(library.getEngineCheckedAt(), "force 路径必须刷新 engineCheckedAt=now");
            verify(libraryRepository).save(library);
        }
    }

    // ---------------------------------------------------------------- 幂等

    @Nested
    @DisplayName("force 幂等")
    class ForceIdempotency {

        @Test
        @DisplayName("本地已不存在 + force=true → 幂等回执（engineMissing=true, docCleaned=0, aclCleaned=0）不报错")
        void idempotentWhenLocalMissingAndForced() {
            when(libraryRepository.findById(999L)).thenReturn(Optional.empty());

            KbLibraryDeleteResultVO vo =
                    service.delete(USER_ID, 999L, LibraryDeleteMode.PHYSICAL, true);

            assertTrue(vo.engineMissing());
            assertEquals(0L, vo.docCleaned());
            assertEquals(0L, vo.aclCleaned());
            assertTrue(vo.message().contains("无需重复处理"));
        }

        @Test
        @DisplayName("本地已不存在 + force=false → 保持抛 KB_LIBRARY_NOT_FOUND")
        void notFoundWhenLocalMissingAndNotForced() {
            when(libraryRepository.findById(999L)).thenReturn(Optional.empty());

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> service.delete(USER_ID, 999L, LibraryDeleteMode.ARCHIVE, false));

            assertEquals(40410, ex.getCode());
        }
    }

    // ---------------------------------------------------------------- force 不豁免

    @Nested
    @DisplayName("force 不豁免其它门控")
    class ForceDoesNotExempt {

        @Test
        @DisplayName("deleteSupported=false + force=true → 仍抛 40934，本地零变更")
        void forceDoesNotExemptDeleteUnsupported() {
            props.setDeleteSupported(false);
            engineDeleteMissing();

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> service.delete(USER_ID, LIBRARY_ID, LibraryDeleteMode.PHYSICAL, true));

            assertEquals(40934, ex.getCode());
            verify(documentRepository, never()).deleteByLibraryId(anyLong());
            verify(libraryRepository, never()).delete(any());
        }

        @Test
        @DisplayName("物理删除非 missing 失败 + force=true → 仍抛 40935 回滚")
        void forceDoesNotExemptEngineDeleteFailure() {
            doThrow(new IllegalStateException("RAGFlow 502"))
                    .when(enginePort).deleteLibrary(any(EngineLibraryRef.class));

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> service.delete(USER_ID, LIBRARY_ID, LibraryDeleteMode.PHYSICAL, true));

            assertEquals(40935, ex.getCode());
            assertTrue(ex.getMessage().contains("RAGFlow 502"));
            verify(documentRepository, never()).deleteByLibraryId(anyLong());
            verify(libraryRepository, never()).delete(any());
        }

        @Test
        @DisplayName("归档非 missing 改名失败 + force=true → 仍 catch 待对账（engine_sync_status=3），本地照常归档")
        void forceKeepsArchiveNonMissingSemantics() {
            doThrow(new IllegalStateException("connect timed out"))
                    .when(enginePort).renameLibrary(any(EngineLibraryRef.class), anyString());

            KbLibraryDeleteResultVO vo =
                    service.delete(USER_ID, LIBRARY_ID, LibraryDeleteMode.ARCHIVE, true);

            assertFalse(vo.engineMissing(), "非 missing 改名失败不产生 engineMissing 信号");
            assertFalse(vo.engineSynced());
            assertEquals(EngineSyncStatus.DRIFT_OR_FAILED, library.getEngineSyncStatus(),
                    "非 missing 改名失败仍置 3 待对账（R6 严格不变）");
            assertEquals(LibraryStatus.DISABLED.code(), library.getStatus());
            assertNotNull(library.getArchivedAt());
        }
    }

    // ---------------------------------------------------------------- 无引擎引用

    @Nested
    @DisplayName("无 engineLibraryRef")
    class NoEngineRef {

        @Test
        @DisplayName("未绑定引擎 → 不触发引擎检测，直接本地执行，不产生 engineMissing（force 任一值）")
        void unboundLibrarySkipsEngineDetection() {
            library.setEngineLibraryRef(null);

            KbLibraryDeleteResultVO vo =
                    service.delete(USER_ID, LIBRARY_ID, LibraryDeleteMode.PHYSICAL, false);

            assertFalse(vo.engineMissing(), "无引擎引用不产生 engineMissing");
            assertTrue(vo.engineSynced());
            verify(enginePort, never()).deleteLibrary(any());
            verify(enginePort, never()).renameLibrary(any(), anyString());
            verify(libraryRepository).delete(library);
        }
    }
}
