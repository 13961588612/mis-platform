package com.mis.kb.domain.service;

import com.mis.kb.domain.entity.KbEngineRenameLog;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.EngineLibraryBrief;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.EngineSyncStatus;
import com.mis.kb.domain.model.KbEngineRenameAction;
import com.mis.kb.domain.model.KbEngineRenameReq;
import com.mis.kb.domain.model.KbEngineRenameResult;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.LibraryStatus;
import com.mis.kb.domain.repository.KbEngineRenameLogRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.engine.RagflowProperties;
import com.mis.kb.support.KbBusinessException;
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
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 存量引擎 dataset 批量重命名服务单测（P1-T4，QA 补强）。
 *
 * <p>覆盖 T4 验收点：受控触发（dryRun 默认 true / confirmToken）、分批 limit 上限、
 * 幂等 SKIP（期望名==实际名）、引擎缺失/归档库跳过、逐条落 {@code kb_engine_rename_log}
 * （含 dry-run 计划行 status=0）、按 batchId 倒序回滚、回滚批次不存在 → 40943、
 * 非 ragflow 引擎 skipped 护栏。
 *
 * <p>注意 {@code rename()} 里通过 {@code self} 代理写单行日志（生产为 REQUIRES_NEW
 * 子事务）；单测无 Spring 容器，直接以同一实例充当 {@code self}，仅验证调用链与落库内容。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("P1-T4 存量 dataset 批量重命名")
class KbEngineLegacyRenameServiceTest {

    private static final long LIB_1 = 1_000_000_000_000_001L;
    private static final long LIB_2 = 1_000_000_000_000_002L;
    private static final long LIB_3 = 1_000_000_000_000_003L;

    @Mock
    private KbLibraryRepository libraryRepository;
    @Mock
    private KbEngineRenameLogRepository renameLogRepository;
    @Mock
    private KbLibraryService libraryService;
    @Mock
    private KnowledgeEnginePort enginePort;

    private RagflowProperties props;
    private KbEngineLegacyRenameService service;

    @BeforeEach
    void setUp() {
        props = new RagflowProperties();
        props.setType("ragflow");
        service = new KbEngineLegacyRenameService(
                libraryRepository, renameLogRepository, libraryService, enginePort, props, null);
        // self 代理：单测无 Spring 容器，用同一实例模拟 REQUIRES_NEW 提交路径
        service = new KbEngineLegacyRenameService(
                libraryRepository, renameLogRepository, libraryService, enginePort, props, service);
        when(enginePort.engineType()).thenReturn("ragflow");
        when(renameLogRepository.save(any(KbEngineRenameLog.class)))
                .thenAnswer(inv -> inv.getArgument(0));
        when(renameLogRepository.findByBatchIdAndStatus(anyString(), any()))
                .thenReturn(List.of());
    }

    /** 普通启用库（未归档、绑定 ragflow dataset）。 */
    private KbLibrary library(long id, String name, String datasetId) {
        KbLibrary lib = new KbLibrary();
        lib.setId(id);
        lib.setName(name);
        lib.setCategoryId(700L);
        lib.setStatus(LibraryStatus.ENABLED.code());
        lib.setEngineType("ragflow");
        lib.setEngineLibraryRef(datasetId);
        lib.setEngineSyncStatus(EngineSyncStatus.UNKNOWN);
        return lib;
    }

    // ------------------------------------------------------------------ 受控触发

    @Nested
    @DisplayName("受控触发：dryRun 默认 true / confirmToken")
    class ControlledTrigger {

        @Test
        @DisplayName("dryRun 不传 → 默认 true，只出计划不调引擎")
        void dryRunDefaultsTrue() {
            KbLibrary drifted = library(LIB_1, "报销制度", "ds-1");
            when(libraryRepository.findAll()).thenReturn(List.of(drifted));
            when(libraryService.expectedEngineName(drifted)).thenReturn("财务-报销制度-000001");
            when(enginePort.listLibraries())
                    .thenReturn(List.of(EngineLibraryBrief.of("ds-1", "历史裸名")));

            KbEngineRenameResult r = service.rename(new KbEngineRenameReq(null, null, null), 100L);

            assertTrue(r.dryRun());
            assertEquals(1, r.total());
            assertEquals(0, r.renamed(), "dry-run 不计数 renamed");
            assertEquals(0, r.skipped());
            assertEquals(0, r.failed());
            assertEquals(1, r.items().size());
            assertEquals(KbEngineRenameAction.RENAME.code(), r.items().get(0).action());
            assertEquals(0, r.items().get(0).status(), "dry-run 计划行 status=0（未执行）");
            // 不调引擎、不改库同步状态
            verify(enginePort, never()).renameLibrary(any(), any());
            verify(libraryRepository, never()).saveAll(any());
        }

        @Test
        @DisplayName("dryRun=false 不带 confirmToken → 40942 且零引擎调用")
        void executeWithoutTokenRejected() {
            KbLibrary drifted = library(LIB_1, "报销制度", "ds-1");
            when(libraryRepository.findAll()).thenReturn(List.of(drifted));
            when(enginePort.listLibraries())
                    .thenReturn(List.of(EngineLibraryBrief.of("ds-1", "历史裸名")));

            KbBusinessException ex = assertThrows(KbBusinessException.class, () ->
                    service.rename(new KbEngineRenameReq(false, null, null), 100L));

            assertEquals(KbResultCode.KB_ENGINE_RENAME_CONFIRM_REQUIRED.getCode(), ex.getCode());
            verify(enginePort, never()).renameLibrary(any(), any());
            verify(enginePort, never()).listLibraries();
        }

        @Test
        @DisplayName("dryRun=false 带错误令牌同样 40942")
        void executeWithWrongTokenRejected() {
            when(libraryRepository.findAll()).thenReturn(List.of());

            KbBusinessException ex = assertThrows(KbBusinessException.class, () ->
                    service.rename(new KbEngineRenameReq(false, "WRONG-TOKEN", null), 100L));

            assertEquals(KbResultCode.KB_ENGINE_RENAME_CONFIRM_REQUIRED.getCode(), ex.getCode());
            verify(enginePort, never()).renameLibrary(any(), any());
        }

        @Test
        @DisplayName("dryRun=false + RENAME-LEGACY → 实际执行并逐条落日志")
        void executeWithToken() {
            KbLibrary drifted = library(LIB_1, "报销制度", "ds-1");
            when(libraryRepository.findAll()).thenReturn(List.of(drifted));
            when(libraryRepository.findById(LIB_1)).thenReturn(java.util.Optional.of(drifted));
            when(libraryService.expectedEngineName(drifted)).thenReturn("财务-报销制度-000001");
            when(enginePort.listLibraries())
                    .thenReturn(List.of(EngineLibraryBrief.of("ds-1", "历史裸名")));

            KbEngineRenameResult r = service.rename(
                    new KbEngineRenameReq(false, KbEngineLegacyRenameService.CONFIRM_TOKEN, null), 100L);

            assertFalse(r.dryRun());
            assertEquals(1, r.renamed());
            assertNotNull(r.batchId());
            // 设计 T4：「成功同时 lib.engine_sync_status=1」——改名成功后本地同步状态应即时回写一致
            assertEquals(EngineSyncStatus.CONSISTENT, drifted.getEngineSyncStatus(),
                    "执行成功后库的 engine_sync_status 必须立刻置 1（设计 T4 关键改动点），不能等下一轮对账");
            // 引擎收到规范名
            verify(enginePort, times(1)).renameLibrary(
                    new EngineLibraryRef("ragflow", "ds-1"), "财务-报销制度-000001");
            // 逐条落日志：action=RENAME status=1 operatorId 透传
            ArgumentCaptor<KbEngineRenameLog> captor = ArgumentCaptor.forClass(KbEngineRenameLog.class);
            verify(renameLogRepository, times(1)).save(captor.capture());
            KbEngineRenameLog row = captor.getValue();
            assertEquals(r.batchId(), row.getBatchId());
            assertEquals(LIB_1, row.getLibraryId());
            assertEquals("历史裸名", row.getOldName());
            assertEquals("财务-报销制度-000001", row.getNewName());
            assertEquals(1, row.getStatus());
            assertEquals(100L, row.getOperatorId().longValue());
        }
    }

    // ------------------------------------------------------------------ limit 与幂等

    @Nested
    @DisplayName("limit 上限 / 幂等 SKIP / 跳过场景")
    class LimitAndIdempotency {

        @Test
        @DisplayName("limit 上限 200：传 999 被归一化到 200")
        void limitCappedAt200() {
            // 250 个库全漂移 → 一次只处理 200 个
            List<KbLibrary> libs = java.util.stream.LongStream.range(0, 250)
                    .mapToObj(i -> library(1_000_000_000_000_100L + i, "库" + i, "ds-" + i))
                    .toList();
            when(libraryRepository.findAll()).thenReturn(libs);
            when(libraryService.expectedEngineName(any(KbLibrary.class)))
                    .thenAnswer(inv -> "财务-" + ((KbLibrary) inv.getArgument(0)).getName() + "-000001");
            when(enginePort.listLibraries()).thenAnswer(inv -> libs.stream()
                    .map(l -> EngineLibraryBrief.of(l.getEngineLibraryRef(), "旧名-" + l.getId()))
                    .toList());

            KbEngineRenameResult r = service.rename(
                    new KbEngineRenameReq(false, KbEngineLegacyRenameService.CONFIRM_TOKEN, 999), 1L);

            assertEquals(200, r.total(), "limit 上限 200，超出即截断");
            verify(enginePort, times(200)).renameLibrary(any(), any());
            verify(renameLogRepository, times(200)).save(any(KbEngineRenameLog.class));
        }

        @Test
        @DisplayName("limit 不传默认 50")
        void limitDefaultsTo50() {
            List<KbLibrary> libs = java.util.stream.LongStream.range(0, 80)
                    .mapToObj(i -> library(1_000_000_000_000_100L + i, "库" + i, "ds-" + i))
                    .toList();
            when(libraryRepository.findAll()).thenReturn(libs);
            when(libraryService.expectedEngineName(any(KbLibrary.class)))
                    .thenAnswer(inv -> "财务-" + ((KbLibrary) inv.getArgument(0)).getName() + "-000001");
            when(enginePort.listLibraries()).thenAnswer(inv -> libs.stream()
                    .map(l -> EngineLibraryBrief.of(l.getEngineLibraryRef(), "旧名-" + l.getId()))
                    .toList());

            KbEngineRenameResult r = service.rename(
                    new KbEngineRenameReq(false, KbEngineLegacyRenameService.CONFIRM_TOKEN, null), 1L);

            assertEquals(50, r.total(), "limit 不传默认 50");
        }

        @Test
        @DisplayName("幂等：期望名==实际名 → SKIP，零引擎调用（重复触发不重复改名）")
        void idempotentSkip() {
            KbLibrary canonical = library(LIB_1, "报销制度", "ds-1");
            when(libraryRepository.findAll()).thenReturn(List.of(canonical));
            when(libraryService.expectedEngineName(canonical)).thenReturn("财务-报销制度-000001");
            when(enginePort.listLibraries())
                    .thenReturn(List.of(EngineLibraryBrief.of("ds-1", "财务-报销制度-000001")));

            KbEngineRenameResult r = service.rename(new KbEngineRenameReq(null, null, null), 1L);

            assertEquals(1, r.skipped());
            assertEquals(1, r.items().size());
            assertEquals(KbEngineRenameAction.SKIP.code(), r.items().get(0).action());
            assertEquals("已规范", r.items().get(0).error());
            verify(enginePort, never()).renameLibrary(any(), any());
        }

        @Test
        @DisplayName("引擎缺失 → SKIP（不拿 null 名去调引擎）")
        void skipWhenEngineMissing() {
            KbLibrary orphaned = library(LIB_1, "报销制度", "ds-gone");
            when(libraryRepository.findAll()).thenReturn(List.of(orphaned));
            when(libraryService.expectedEngineName(orphaned)).thenReturn("财务-报销制度-000001");
            when(enginePort.listLibraries()).thenReturn(List.of()); // ds-gone 不在引擎侧

            KbEngineRenameResult r = service.rename(new KbEngineRenameReq(null, null, null), 1L);

            assertEquals(1, r.skipped());
            assertEquals("引擎缺失", r.items().get(0).error());
            verify(enginePort, never()).renameLibrary(any(), any());
        }

        @Test
        @DisplayName("归档库 → SKIP（不破坏归档名语义）")
        void skipArchivedLibrary() {
            KbLibrary archived = library(LIB_1, "旧制度", "ds-1");
            archived.setStatus(LibraryStatus.DISABLED.code());
            archived.setArchivedAt(Instant.now().minus(30, java.time.temporal.ChronoUnit.DAYS));
            when(libraryRepository.findAll()).thenReturn(List.of(archived));
            when(libraryService.expectedEngineName(archived)).thenReturn("财务-旧制度-000001");
            when(enginePort.listLibraries())
                    .thenReturn(List.of(EngineLibraryBrief.of("ds-1", "[已归档-20260701]-财务-旧制度-000001")));

            KbEngineRenameResult r = service.rename(new KbEngineRenameReq(null, null, null), 1L);

            assertEquals(1, r.skipped());
            assertEquals("归档库不自动改名", r.items().get(0).error());
            verify(enginePort, never()).renameLibrary(any(), any());
        }
    }

    // ------------------------------------------------------------------ 执行失败 / 可中断

    @Nested
    @DisplayName("执行失败与可中断")
    class ExecutionFailure {

        @Test
        @DisplayName("单条引擎失败 → 该条 FAILED 记 error，其余继续（可中断可重跑）")
        void singleFailureDoesNotAbortBatch() {
            KbLibrary ok = library(LIB_1, "报销制度", "ds-1");
            KbLibrary bad = library(LIB_2, "差旅制度", "ds-2");
            when(libraryRepository.findAll()).thenReturn(List.of(ok, bad));
            when(libraryService.expectedEngineName(any(KbLibrary.class))).thenAnswer(inv -> {
                KbLibrary l = inv.getArgument(0);
                return "财务-" + l.getName() + "-00000" + (l.getId() % 10);
            });
            when(enginePort.listLibraries()).thenReturn(List.of(
                    EngineLibraryBrief.of("ds-1", "旧名1"),
                    EngineLibraryBrief.of("ds-2", "旧名2")));
            // ds-2 改名抛异常（void 方法用 doThrow；参数用精确值避免 matcher 计数问题）
            doThrow(new IllegalStateException("RAGFlow 500"))
                    .when(enginePort).renameLibrary(
                            new EngineLibraryRef("ragflow", "ds-2"), "财务-差旅制度-000002");
            doNothing()
                    .when(enginePort).renameLibrary(
                            new EngineLibraryRef("ragflow", "ds-1"), "财务-报销制度-000001");

            KbEngineRenameResult r = service.rename(
                    new KbEngineRenameReq(false, KbEngineLegacyRenameService.CONFIRM_TOKEN, null), 1L);

            assertEquals(2, r.total());
            assertEquals(1, r.renamed());
            assertEquals(1, r.failed());
            // 失败条：action=FAILED status=2 error 非空
            KbEngineRenameResult.Item failedItem = r.items().stream()
                    .filter(i -> i.nativeId().equals("ds-2")).findFirst().orElseThrow();
            assertEquals(KbEngineRenameAction.FAILED.code(), failedItem.action());
            assertEquals(2, failedItem.status());
            assertNotNull(failedItem.error());
            // 成功条照常执行（ds-1 期望名由 expectedEngineName stub 算出）
            verify(enginePort, times(1)).renameLibrary(
                    new EngineLibraryRef("ragflow", "ds-1"), "财务-报销制度-000001");
            // 两条各落一行日志
            verify(renameLogRepository, times(2)).save(any(KbEngineRenameLog.class));
        }
    }

    // ------------------------------------------------------------------ 回滚

    @Nested
    @DisplayName("按 batchId 回滚")
    class Rollback {

        private KbEngineRenameLog successRow(long id, String nativeId, String oldName, String newName) {
            KbEngineRenameLog row = new KbEngineRenameLog();
            row.setId(id);
            row.setBatchId("batch-1");
            row.setLibraryId(id);
            row.setEngineType("ragflow");
            row.setNativeId(nativeId);
            row.setOldName(oldName);
            row.setNewName(newName);
            row.setAction(KbEngineRenameAction.RENAME.code());
            row.setStatus(1);
            row.setCreatedAt(Instant.now());
            return row;
        }

        @Test
        @DisplayName("回滚成功行：引擎改回 old_name、落 ROLLBACK 批次日志（RB- 前缀）")
        void rollbackRestoresOldName() {
            KbEngineRenameLog row = successRow(LIB_1, "ds-1", "历史裸名", "财务-报销制度-000001");
            when(renameLogRepository.findByBatchIdAndStatus("batch-1", 1)).thenReturn(List.of(row));

            KbEngineRenameResult r = service.rollback("batch-1", 100L);

            assertEquals(1, r.renamed());
            assertTrue(r.batchId().startsWith("RB-"));
            // 引擎收到 old_name（new→old）
            verify(enginePort, times(1)).renameLibrary(
                    new EngineLibraryRef("ragflow", "ds-1"), "历史裸名");
            // 新日志：batchId=RB-batch-1、old/new 交换、action=ROLLBACK（设计 T4：回滚日志用 ROLLBACK 区分审计口径）、status=1
            ArgumentCaptor<KbEngineRenameLog> captor = ArgumentCaptor.forClass(KbEngineRenameLog.class);
            verify(renameLogRepository, times(1)).save(captor.capture());
            KbEngineRenameLog rbLog = captor.getValue();
            assertEquals("RB-batch-1", rbLog.getBatchId());
            assertEquals(KbEngineRenameAction.ROLLBACK.code(), rbLog.getAction(),
                    "回滚日志 action 必须为 ROLLBACK（设计 T4），不能与执行改名 RENAME 混淆");
            assertEquals("财务-报销制度-000001", rbLog.getOldName(), "回滚日志 old=原 new");
            assertEquals("历史裸名", rbLog.getNewName(), "回滚日志 new=原 old");
            assertEquals(100L, rbLog.getOperatorId().longValue());
        }

        @Test
        @DisplayName("回滚按成功行倒序执行（最后改的先还原）")
        void rollbackInReverseOrder() {
            KbEngineRenameLog first = successRow(LIB_1, "ds-1", "旧名1", "新名1");
            first.setCreatedAt(Instant.now().minusSeconds(60));
            KbEngineRenameLog second = successRow(LIB_2, "ds-2", "旧名2", "新名2");
            second.setCreatedAt(Instant.now());
            when(renameLogRepository.findByBatchIdAndStatus("batch-1", 1))
                    .thenReturn(List.of(first, second));

            service.rollback("batch-1", 1L);

            // 先还原第二行（createdAt 更新），再还原第一行
            org.mockito.InOrder inOrder = org.mockito.Mockito.inOrder(enginePort);
            inOrder.verify(enginePort).renameLibrary(new EngineLibraryRef("ragflow", "ds-2"), "旧名2");
            inOrder.verify(enginePort).renameLibrary(new EngineLibraryRef("ragflow", "ds-1"), "旧名1");
        }

        @Test
        @DisplayName("批次不存在或无成功记录 → 40943")
        void rollbackMissingBatchRejected() {
            when(renameLogRepository.findByBatchIdAndStatus("no-such", 1)).thenReturn(List.of());

            KbBusinessException ex = assertThrows(KbBusinessException.class, () ->
                    service.rollback("no-such", 1L));

            assertEquals(KbResultCode.KB_ENGINE_RENAME_BATCH_NOT_FOUND.getCode(), ex.getCode());
            verify(enginePort, never()).renameLibrary(any(), any());
        }
    }

    // ------------------------------------------------------------------ 非 ragflow 护栏

    @Nested
    @DisplayName("非 ragflow 引擎护栏")
    class NonRagflowGuard {

        @Test
        @DisplayName("noop 引擎 → engineSkipped=true，零引擎调用零日志")
        void noopSkipped() {
            props.setType("noop");

            KbEngineRenameResult r = service.rename(new KbEngineRenameReq(null, null, null), 1L);

            assertTrue(r.engineSkipped());
            assertNull(r.batchId());
            assertNotNull(r.skipReason());
            assertTrue(r.skipReason().contains("noop"));
            verify(enginePort, never()).listLibraries();
            verify(enginePort, never()).renameLibrary(any(), any());
            verify(renameLogRepository, never()).save(any());
        }

        @Test
        @DisplayName("无 @Scheduled：类上没有定时注解（受控端点，绝不自动跑）")
        void noScheduledAnnotation() {
            assertNull(service.getClass().getAnnotation(org.springframework.scheduling.annotation.Scheduled.class));
            boolean hasScheduledMethod = java.util.Arrays.stream(service.getClass().getDeclaredMethods())
                    .anyMatch(m -> m.getAnnotation(org.springframework.scheduling.annotation.Scheduled.class) != null);
            assertFalse(hasScheduledMethod, "T4 禁止 @Scheduled——只能运维手动触发");
        }
    }
}
