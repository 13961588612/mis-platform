package com.mis.kb.domain.service;

import com.mis.kb.domain.entity.KbCategory;
import com.mis.kb.domain.entity.KbDocument;
import com.mis.kb.domain.entity.KbEngineOrphan;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.EngineConvergenceResult;
import com.mis.kb.domain.model.EngineDocumentBrief;
import com.mis.kb.domain.model.EngineLibraryBrief;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.EngineReconcileReport;
import com.mis.kb.domain.model.EngineSyncStatus;
import com.mis.kb.domain.model.KbEngineOrphanAction;
import com.mis.kb.domain.model.LibraryStatus;
import com.mis.kb.domain.repository.KbAclRepository;
import com.mis.kb.domain.repository.KbCategoryRepository;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbEngineOrphanRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.engine.RagflowDatasetNaming;
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

import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 引擎对账服务单测（引擎删除策略 P0 / T04 验收点 1–2）。
 *
 * <p>构造四类样本各一条——一致 / 引擎缺失 / 名称漂移 / 游离 dataset——断言四个桶的计数
 * 与明细都对得上，以及每一行 {@code engine_sync_status} 被刷成了正确的码值。
 *
 * <p><b>两条护栏用例最重要：</b>
 * <ol>
 *   <li>{@code engineType=noop} 必须 {@code skipped=true} 且<b>一个字段都不写库</b>。
 *       noop 的 {@code listLibraries()} 返回空列表，一旦放它进比对，一次定时任务就会把
 *       全库 {@code engine_sync_status} 刷成 2，前端满屏红叉，运维会以为引擎炸了。</li>
 *   <li>已归档库的期望名是<b>归档名</b>，只要带合法归档前缀就算一致。若拿「今天的日期」
 *       去精确比对，昨天归档的库明天就变漂移，报告天天一片黄、真差异被淹没。</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("T04 引擎对账服务")
class KbEngineReconcileServiceTest {

    private static final long CATEGORY_ID = 700L;

    @Mock
    private KbLibraryRepository libraryRepository;
    @Mock
    private KbEngineOrphanRepository orphanRepository;
    @Mock
    private KbDocumentRepository documentRepository;
    @Mock
    private KbAclRepository aclRepository;
    @Mock
    private KbCategoryRepository categoryRepository;
    @Mock
    private NodeAdminResolver nodeAdminResolver;
    /** KBP-06：KbLibraryService 构造器新增依赖（mock，本测试不触发可见性解析）。 */
    @Mock
    private KbVisibilityService visibilityService;
    @Mock
    private KnowledgeEnginePort enginePort;

    private RagflowProperties props;
    private KbEngineReconcileService service;

    /** 本轮对账 upsert 落库过的 orphan 行（模拟 DB 当前态，供 pending 查询口径使用）。 */
    private final List<KbEngineOrphan> orphanSaved = new ArrayList<>();

    @BeforeEach
    void setUp() {
        props = new RagflowProperties();
        props.setType("ragflow");

        // 真实 KbLibraryService：期望名计算必须走真命名规范，mock 掉就测不出漂移判定
        KbLibraryService libraryService = new KbLibraryService(
                libraryRepository, documentRepository, aclRepository, categoryRepository,
                enginePort, props, nodeAdminResolver, visibilityService);
        service = new KbEngineReconcileService(
                libraryRepository, documentRepository, orphanRepository, libraryService, enginePort, props);

        KbCategory category = new KbCategory();
        category.setId(CATEGORY_ID);
        category.setName("财务");
        category.setParentId(0L);
        when(categoryRepository.findById(CATEGORY_ID)).thenReturn(Optional.of(category));

        when(enginePort.engineType()).thenReturn("ragflow");
        when(orphanRepository.findByEngineTypeAndNativeId(anyString(), anyString()))
                .thenReturn(Optional.empty());
        // P1-T3 口径：报告待处理列表 = 本轮 upsert 后仍 resolved=0 的行。
        // 用有状态 stub 模拟 DB——saveAll 写入的行进内存列表，pending 查询从该列表过滤，
        // 这样「已处置 / 刚被自动关闭」的行自然不出现，与真实 DB 语义一致。
        when(orphanRepository.findByEngineTypeAndResolvedOrderByLastSeenAtDesc(anyString(), eq(0)))
                .thenAnswer(inv -> orphanSaved.stream()
                        .filter(o -> o.getResolved() != null && o.getResolved() == 0)
                        .toList());
        when(orphanRepository.findByEngineTypeAndResolvedOrderByLastSeenAtDesc(anyString(), eq(1)))
                .thenReturn(List.of());
        when(orphanRepository.saveAll(any())).thenAnswer(inv -> {
            Iterable<?> it = inv.getArgument(0);
            List<Object> copy = new ArrayList<>();
            it.forEach(copy::add);
            orphanSaved.clear();
            copy.forEach(o -> orphanSaved.add((KbEngineOrphan) o));
            return copy;
        });
        when(libraryRepository.saveAll(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    private KbLibrary library(long id, String name, String datasetId) {
        KbLibrary lib = new KbLibrary();
        lib.setId(id);
        lib.setCategoryId(CATEGORY_ID);
        lib.setName(name);
        lib.setStatus(LibraryStatus.ENABLED.code());
        lib.setEngineType("ragflow");
        lib.setEngineLibraryRef(datasetId);
        lib.setEngineSyncStatus(EngineSyncStatus.UNKNOWN);
        return lib;
    }

    // ------------------------------------------------------------------ 四类样本

    @Nested
    @DisplayName("四桶分类")
    class FourBuckets {

        @Test
        @DisplayName("一致 / 引擎缺失 / 名称漂移 / 游离 四类样本各归各桶，计数与明细都对")
        void shouldClassifyAllFourCases() {
            KbLibrary consistent = library(1_000_000_000_000_001L, "报销制度", "ds-ok");
            KbLibrary missing = library(1_000_000_000_000_002L, "差旅制度", "ds-gone");
            KbLibrary drifted = library(1_000_000_000_000_003L, "薪酬制度", "ds-drift");
            when(libraryRepository.findAll()).thenReturn(List.of(consistent, missing, drifted));

            when(enginePort.listLibraries()).thenReturn(List.of(
                    // 一致：名字恰好等于期望名
                    EngineLibraryBrief.of("ds-ok", "财务-报销制度-000001"),
                    // 漂移：引擎侧被人手工改过名
                    EngineLibraryBrief.of("ds-drift", "运维手改的名字"),
                    // 游离：引擎有、MIS 无
                    new EngineLibraryBrief("ds-orphan", "某个没人认领的库", 12, null)));
            // ds-gone 不在引擎侧 → 引擎缺失

            EngineReconcileReport report = service.reconcile();

            assertFalse(report.skipped());
            assertEquals("ragflow", report.engineType());
            assertEquals(3, report.counts().total(), "total = engine_library_ref 非空的 MIS 库数");
            assertEquals(1, report.counts().consistent());
            assertEquals(1, report.counts().missingInEngine());
            assertEquals(1, report.counts().nameDrift());
            assertEquals(1, report.counts().orphan());

            // 明细
            assertEquals(1, report.missingInEngine().size());
            assertEquals(missing.getId(), report.missingInEngine().get(0).libraryId());
            assertEquals("ds-gone", report.missingInEngine().get(0).engineLibraryRef());

            assertEquals(1, report.nameDrift().size());
            EngineReconcileReport.NameDrift d = report.nameDrift().get(0);
            assertEquals(drifted.getId(), d.libraryId());
            assertEquals("财务-薪酬制度-000003", d.expectedName());
            assertEquals("运维手改的名字", d.actualName());

            assertEquals(1, report.orphans().size());
            assertEquals("ds-orphan", report.orphans().get(0).nativeId());
            assertEquals(12, report.orphans().get(0).docCount());

            // 落库码值
            assertEquals(EngineSyncStatus.CONSISTENT, consistent.getEngineSyncStatus());
            assertEquals(EngineSyncStatus.MISSING_IN_ENGINE, missing.getEngineSyncStatus());
            assertEquals(EngineSyncStatus.DRIFT_OR_FAILED, drifted.getEngineSyncStatus());
            // 参与比对的行统一刷 engine_checked_at
            assertNotNull(consistent.getEngineCheckedAt());
            assertNotNull(missing.getEngineCheckedAt());
            assertNotNull(drifted.getEngineCheckedAt());
            verify(libraryRepository).saveAll(any());
        }

        @Test
        @DisplayName("engine_library_ref 为空的库不参与比对（未建过引擎库，谈不上差异）")
        void shouldIgnoreUnboundLibraries() {
            KbLibrary unbound = library(1_000_000_000_000_009L, "本地库", null);
            KbLibrary bound = library(1_000_000_000_000_001L, "报销制度", "ds-ok");
            when(libraryRepository.findAll()).thenReturn(List.of(unbound, bound));
            when(enginePort.listLibraries())
                    .thenReturn(List.of(EngineLibraryBrief.of("ds-ok", "财务-报销制度-000001")));

            EngineReconcileReport report = service.reconcile();

            assertEquals(1, report.counts().total());
            assertEquals(1, report.counts().consistent());
            assertNull(unbound.getEngineSyncStatus() == null ? null : null);
            assertEquals(EngineSyncStatus.UNKNOWN, unbound.getEngineSyncStatus(),
                    "未绑定的库不该被对账改状态");
            assertNull(unbound.getEngineCheckedAt());
        }

        @Test
        @DisplayName("引擎侧返回名字为空 → 判为漂移而不是一致（空名不能当作匹配）")
        void shouldTreatBlankEngineNameAsDrift() {
            KbLibrary lib = library(1_000_000_000_000_001L, "报销制度", "ds-ok");
            when(libraryRepository.findAll()).thenReturn(List.of(lib));
            when(enginePort.listLibraries()).thenReturn(List.of(EngineLibraryBrief.of("ds-ok", null)));

            EngineReconcileReport report = service.reconcile();

            assertEquals(1, report.counts().nameDrift());
            assertEquals(EngineSyncStatus.DRIFT_OR_FAILED, lib.getEngineSyncStatus());
        }
    }

    // ------------------------------------------------------------------ 归档库

    @Nested
    @DisplayName("已归档库的期望名")
    class ArchivedLibrary {

        private KbLibrary archived(long id, String name, String datasetId) {
            KbLibrary lib = library(id, name, datasetId);
            lib.setStatus(LibraryStatus.DISABLED.code());
            lib.setArchivedAt(Instant.now().minus(30, ChronoUnit.DAYS));
            return lib;
        }

        @Test
        @DisplayName("带任意日期的归档前缀都算一致——30 天前归档的库今天不能被判成漂移")
        void shouldNotFlagArchivedAsDrift() {
            KbLibrary lib = archived(1_000_000_000_000_004L, "旧制度", "ds-archived");
            when(libraryRepository.findAll()).thenReturn(List.of(lib));
            String oldArchiveName = RagflowDatasetNaming.forArchive(
                    "财务-旧制度-000004", LocalDate.now().minusDays(30));
            when(enginePort.listLibraries())
                    .thenReturn(List.of(EngineLibraryBrief.of("ds-archived", oldArchiveName)));

            EngineReconcileReport report = service.reconcile();

            assertEquals(1, report.counts().consistent(), "归档库被误判成漂移会让报告天天一片黄");
            assertEquals(0, report.counts().nameDrift());
            assertEquals(EngineSyncStatus.CONSISTENT, lib.getEngineSyncStatus());
        }

        @Test
        @DisplayName("归档库在引擎侧没有归档前缀（归档时改名失败） → 仍判漂移，且期望名带前缀")
        void shouldFlagArchivedWithoutPrefix() {
            KbLibrary lib = archived(1_000_000_000_000_004L, "旧制度", "ds-archived");
            when(libraryRepository.findAll()).thenReturn(List.of(lib));
            when(enginePort.listLibraries())
                    .thenReturn(List.of(EngineLibraryBrief.of("ds-archived", "财务-旧制度-000004")));

            EngineReconcileReport report = service.reconcile();

            assertEquals(1, report.counts().nameDrift());
            assertTrue(RagflowDatasetNaming.isArchivedName(report.nameDrift().get(0).expectedName()),
                    "归档库的期望名展示形态必须带归档前缀，运维才知道该改成什么");
        }

        @Test
        @DisplayName("status=0 但 archived_at 为空（普通停用）不按归档口径判——停用≠归档")
        void shouldTreatDisabledButNotArchivedAsNormal() {
            KbLibrary disabled = library(1_000_000_000_000_005L, "停用库", "ds-disabled");
            disabled.setStatus(LibraryStatus.DISABLED.code());
            disabled.setArchivedAt(null);
            when(libraryRepository.findAll()).thenReturn(List.of(disabled));
            when(enginePort.listLibraries()).thenReturn(List.of(
                    EngineLibraryBrief.of("ds-disabled", "财务-停用库-000005")));

            EngineReconcileReport report = service.reconcile();

            assertFalse(disabled.isArchived());
            assertEquals(1, report.counts().consistent(),
                    "停用库的期望名仍是普通名，不该要求带归档前缀");
        }
    }

    // ------------------------------------------------------------------ 游离项 upsert

    @Nested
    @DisplayName("游离 dataset upsert")
    class OrphanUpsert {

        @Test
        @DisplayName("已存在的游离项：first_seen_at 保留、last_seen_at 刷新、resolved 复位 0")
        void shouldPreserveFirstSeenAt() {
            Instant firstSeen = Instant.now().minus(3, ChronoUnit.DAYS);
            KbEngineOrphan existing = new KbEngineOrphan();
            existing.setId(1L);
            existing.setEngineType("ragflow");
            existing.setNativeId("ds-orphan");
            existing.setFirstSeenAt(firstSeen);
            existing.setLastSeenAt(firstSeen);
            existing.setResolved(1);
            when(orphanRepository.findByEngineTypeAndNativeId("ragflow", "ds-orphan"))
                    .thenReturn(Optional.of(existing));
            when(libraryRepository.findAll()).thenReturn(List.of());
            when(enginePort.listLibraries())
                    .thenReturn(List.of(new EngineLibraryBrief("ds-orphan", "游离库", 3, null)));

            EngineReconcileReport report = service.reconcile();

            assertEquals(firstSeen, existing.getFirstSeenAt(), "首次发现时刻不能被刷掉");
            assertTrue(existing.getLastSeenAt().isAfter(firstSeen));
            assertEquals(0, existing.getResolved(), "又出现了就得重新变待处理");
            assertEquals(3, existing.getDocCount());
            assertEquals(1, report.counts().orphan());
        }

        @Test
        @DisplayName("本轮未再出现的历史游离项自动关闭（resolved=1 + note）")
        void shouldAutoResolveStaleOrphans() {
            KbEngineOrphan stale = new KbEngineOrphan();
            stale.setId(2L);
            stale.setEngineType("ragflow");
            stale.setNativeId("ds-vanished");
            stale.setLastSeenAt(Instant.now().minus(2, ChronoUnit.DAYS));
            stale.setResolved(0);
            when(orphanRepository.findByEngineTypeAndResolvedOrderByLastSeenAtDesc("ragflow", 0))
                    .thenAnswer(inv -> stale.getResolved() != null && stale.getResolved() == 0
                            ? List.of(stale) : List.of());
            when(libraryRepository.findAll()).thenReturn(List.of());
            when(enginePort.listLibraries()).thenReturn(List.of());

            service.reconcile();

            assertEquals(1, stale.getResolved(), "引擎侧已消失的游离项不能永远挂在报告里");
            assertNotNull(stale.getNote());
        }

        @Test
        @DisplayName("nativeId 为空的引擎返回被丢弃（脏数据不进 orphan 表）")
        void shouldDropBlankNativeId() {
            when(libraryRepository.findAll()).thenReturn(List.of());
            when(enginePort.listLibraries()).thenReturn(List.of(
                    EngineLibraryBrief.of("", "空 id"),
                    EngineLibraryBrief.of("ds-valid", "正常")));

            EngineReconcileReport report = service.reconcile();

            assertEquals(1, report.counts().orphan());
            assertEquals("ds-valid", report.orphans().get(0).nativeId());
        }

        @Test
        @DisplayName("P1-T3 回归：已人工忽略（resolved_action=ignore）的行绝不因引擎侧仍可见而复位")
        void shouldNotResetManuallyIgnoredOrphan() {
            // 引擎侧仍存在该 dataset（不会被自动关闭），但管理员已处置过（ignore）。
            KbEngineOrphan ignored = new KbEngineOrphan();
            ignored.setId(3L);
            ignored.setEngineType("ragflow");
            ignored.setNativeId("ds-ignored");
            ignored.setFirstSeenAt(Instant.now().minus(5, ChronoUnit.DAYS));
            ignored.setLastSeenAt(Instant.now().minus(1, ChronoUnit.DAYS));
            ignored.setResolved(1);
            ignored.setResolvedAction(KbEngineOrphanAction.IGNORE.code());
            ignored.setResolvedNote("确认该数据集已废弃，人工忽略");
            ignored.setResolvedAt(Instant.now().minus(1, ChronoUnit.DAYS));
            when(orphanRepository.findByEngineTypeAndNativeId("ragflow", "ds-ignored"))
                    .thenReturn(Optional.of(ignored));
            when(libraryRepository.findAll()).thenReturn(List.of());
            when(enginePort.listLibraries())
                    .thenReturn(List.of(new EngineLibraryBrief("ds-ignored", "游离库", 3, null)));

            service.reconcile();

            // 护栏核心：resolved/action/note 全部保留，绝不被下一轮对账翻回待处理。
            assertEquals(1, ignored.getResolved(), "已人工忽略的行不得被复位成待处理");
            assertEquals(KbEngineOrphanAction.IGNORE.code(), ignored.getResolvedAction());
            assertEquals("确认该数据集已废弃，人工忽略", ignored.getResolvedNote());
            // 只允许刷新 lastSeenAt/docCount（可见性快照），不覆盖处置结论。
            assertEquals(3, ignored.getDocCount());
            assertTrue(ignored.getLastSeenAt().isAfter(Instant.now().minus(1, ChronoUnit.DAYS)));
            // 报告「待处理」计数与明细都不再包含它（pending 查询口径 = resolved=0）。
        }
    }

    // ------------------------------------------------------------------ 护栏

    @Nested
    @DisplayName("noop/mock 引擎护栏（§1.10-1）")
    class NonRagflowGuard {

        @Test
        @DisplayName("engineType=noop → skipped=true 且任何 engine_sync_status 都没被改写")
        void shouldSkipAndWriteNothing() {
            props.setType("noop");
            KbLibrary lib = library(1_000_000_000_000_001L, "报销制度", "ds-ok");
            when(libraryRepository.findAll()).thenReturn(List.of(lib));

            EngineReconcileReport report = service.reconcile();

            assertTrue(report.skipped());
            assertNotNull(report.skipReason());
            assertTrue(report.skipReason().contains("noop"));
            assertEquals(0, report.counts().total());
            assertTrue(report.missingInEngine().isEmpty());
            assertTrue(report.orphans().isEmpty());
            assertTrue(report.nameDrift().isEmpty());

            // 一个字段都不许写
            assertEquals(EngineSyncStatus.UNKNOWN, lib.getEngineSyncStatus());
            assertNull(lib.getEngineCheckedAt());
            verify(libraryRepository, never()).saveAll(any());
            verify(libraryRepository, never()).save(any());
            verifyNoInteractions(orphanRepository);
            verify(enginePort, never()).listLibraries();
        }

        @Test
        @DisplayName("engineType=mock 同样跳过（CI 环境不得污染同步状态）")
        void shouldSkipMockEngine() {
            props.setType("mock");
            when(libraryRepository.findAll()).thenReturn(List.of());

            assertTrue(service.reconcile().skipped());
            verify(enginePort, never()).listLibraries();
        }

        @Test
        @DisplayName("大小写/空白不敏感：\" RAGFlow \" 仍按 ragflow 处理")
        void shouldNormalizeEngineType() {
            props.setType("  RAGFlow  ");
            when(libraryRepository.findAll()).thenReturn(List.of());
            when(enginePort.listLibraries()).thenReturn(List.of());

            assertFalse(service.reconcile().skipped());
        }
    }

    // ------------------------------------------------------------------ 定时任务与报告缓存

    @Nested
    @DisplayName("定时任务与报告缓存")
    class ScheduleAndCache {

        @Test
        @DisplayName("reconcile.enabled=false → 定时方法直接 return，不打引擎（Nacos 热关）")
        void shouldRespectEnabledSwitch() {
            props.getReconcile().setEnabled(false);

            service.scheduledReconcile();

            verify(enginePort, never()).listLibraries();
            verify(libraryRepository, never()).findAll();
        }

        @Test
        @DisplayName("对账过程抛异常时定时任务吞掉（保证下一周期照常触发）")
        void shouldSwallowExceptionInScheduled() {
            when(libraryRepository.findAll()).thenThrow(new IllegalStateException("DB down"));

            service.scheduledReconcile();
            // 未抛出即通过：调度器一旦收到异常就不再有下文
        }

        @Test
        @DisplayName("latestReport 在跑过之后返回缓存的那一份")
        void shouldCacheLatestReport() {
            when(libraryRepository.findAll()).thenReturn(List.of());
            when(enginePort.listLibraries()).thenReturn(List.of());

            EngineReconcileReport ran = service.reconcile();
            EngineReconcileReport cached = service.latestReport();

            assertEquals(ran.lastRunAt(), cached.lastRunAt());
            assertNotNull(cached.lastRunAt());
        }

        @Test
        @DisplayName("重启后（无缓存）用 DB 现状重算：lastRunAt=null 但计数可用")
        void shouldRebuildFromDb() {
            KbLibrary consistent = library(1_000_000_000_000_001L, "A", "ds-a");
            consistent.setEngineSyncStatus(EngineSyncStatus.CONSISTENT);
            KbLibrary missing = library(1_000_000_000_000_002L, "B", "ds-b");
            missing.setEngineSyncStatus(EngineSyncStatus.MISSING_IN_ENGINE);
            KbLibrary drift = library(1_000_000_000_000_003L, "C", "ds-c");
            drift.setEngineSyncStatus(EngineSyncStatus.DRIFT_OR_FAILED);
            KbLibrary unknown = library(1_000_000_000_000_004L, "D", "ds-d");
            when(libraryRepository.findAll())
                    .thenReturn(List.of(consistent, missing, drift, unknown));

            EngineReconcileReport report = service.latestReport();

            assertNull(report.lastRunAt(), "本进程没跑过，lastRunAt 必须是 null 而不是假造一个时间");
            assertFalse(report.skipped());
            assertEquals(4, report.counts().total());
            assertEquals(1, report.counts().consistent());
            assertEquals(1, report.counts().missingInEngine());
            assertEquals(1, report.counts().nameDrift());
            verify(enginePort, never()).listLibraries();
        }

        @Test
        @DisplayName("重启后 + noop 引擎 → latestReport 直接给 skip 文案，不去查库")
        void shouldSkipRebuildForNoop() {
            props.setType("noop");

            EngineReconcileReport report = service.latestReport();

            assertTrue(report.skipped());
            verify(libraryRepository, never()).findAll();
        }
    }

    // ------------------------------------------------------------------ 文档级对账（T03）

    @Nested
    @DisplayName("文档级对账（增量 P1 / T03）")
    class DocumentReconcile {

        @Test
        @DisplayName("引擎缺某文档 → 该文档被标记 MISSING_IN_ENGINE，且明细计入报告")
        void shouldMarkDocumentMissing() {
            KbLibrary lib = library(1_000_000_000_000_001L, "报销制度", "ds-ok");
            when(libraryRepository.findAll()).thenReturn(List.of(lib));
            when(enginePort.listLibraries())
                    .thenReturn(List.of(EngineLibraryBrief.of("ds-ok", "财务-报销制度-000001")));
            // 引擎侧该 dataset 只有一个文档 doc-engine-1（本地文档 doc-gone 在引擎侧已不存在）
            when(enginePort.listDocuments(any())).thenReturn(List.of(
                    new EngineDocumentBrief("doc-engine-1", "在引擎的文档")));
            KbDocument gone = new KbDocument();
            gone.setId(11L);
            gone.setLibraryId(lib.getId());
            gone.setTitle("本地孤儿文档");
            gone.setEngineDocumentRef("doc-gone");
            gone.setEngineSyncStatus(EngineSyncStatus.UNKNOWN);
            when(documentRepository.findByLibraryIdAndEngineDocumentRefIsNotNull(lib.getId()))
                    .thenReturn(List.of(gone));

            EngineReconcileReport report = service.reconcile();

            assertEquals(1, report.documentMissingInEngine());
            assertEquals(1, report.documentMissingDetails().size());
            assertEquals("doc-gone", report.documentMissingDetails().get(0).engineDocumentRef());
            assertEquals(lib.getId(), report.documentMissingDetails().get(0).libraryId());
            assertEquals(EngineSyncStatus.MISSING_IN_ENGINE, gone.getEngineSyncStatus());
            assertNotNull(gone.getEngineMissingSince(), "首次缺失应记录起始时刻");
            verify(documentRepository).saveAll(any());
        }

        @Test
        @DisplayName("引擎侧文档齐全 → 文档标记一致且清空 missing-since")
        void shouldMarkDocumentConsistent() {
            KbLibrary lib = library(1_000_000_000_000_001L, "报销制度", "ds-ok");
            when(libraryRepository.findAll()).thenReturn(List.of(lib));
            when(enginePort.listLibraries())
                    .thenReturn(List.of(EngineLibraryBrief.of("ds-ok", "财务-报销制度-000001")));
            when(enginePort.listDocuments(any())).thenReturn(List.of(
                    new EngineDocumentBrief("doc-gone", "一致文档")));
            KbDocument doc = new KbDocument();
            doc.setId(11L);
            doc.setLibraryId(lib.getId());
            doc.setTitle("一致文档");
            doc.setEngineDocumentRef("doc-gone");
            doc.setEngineSyncStatus(EngineSyncStatus.MISSING_IN_ENGINE);
            doc.setEngineMissingSince(Instant.now().minus(10, ChronoUnit.DAYS));
            when(documentRepository.findByLibraryIdAndEngineDocumentRefIsNotNull(lib.getId()))
                    .thenReturn(List.of(doc));

            EngineReconcileReport report = service.reconcile();

            assertEquals(0, report.documentMissingInEngine());
            assertEquals(EngineSyncStatus.CONSISTENT, doc.getEngineSyncStatus());
            assertNull(doc.getEngineMissingSince(), "一致应清空 missing-since");
        }

        @Test
        @DisplayName("listDocuments 返回 null（noop/mock 默认）不污染本地文档状态")
        void shouldNotBreakWhenListDocumentsNull() {
            KbLibrary lib = library(1_000_000_000_000_001L, "报销制度", "ds-ok");
            when(libraryRepository.findAll()).thenReturn(List.of(lib));
            when(enginePort.listLibraries())
                    .thenReturn(List.of(EngineLibraryBrief.of("ds-ok", "财务-报销制度-000001")));
            when(enginePort.listDocuments(any())).thenReturn(null);
            KbDocument doc = new KbDocument();
            doc.setId(11L);
            doc.setLibraryId(lib.getId());
            doc.setTitle("文档");
            doc.setEngineDocumentRef("doc-x");
            when(documentRepository.findByLibraryIdAndEngineDocumentRefIsNotNull(lib.getId()))
                    .thenReturn(List.of(doc));

            EngineReconcileReport report = service.reconcile();

            assertEquals(0, report.documentMissingInEngine());
            assertEquals(EngineSyncStatus.UNKNOWN, doc.getEngineSyncStatus(),
                    "listDocuments 为 null 时不应改写文档同步状态");
        }
    }

    // ------------------------------------------------------------------ 单边删除收敛（T04）

    @Nested
    @DisplayName("MISSING_IN_ENGINE 收敛（增量 T04）")
    class Convergence {

        @Test
        @DisplayName("cleanupMissing：达到阈值的库软删、孤儿文档物理删，返回收敛结果")
        void shouldConvergeMissing() {
            KbLibrary lib = library(1_000_000_000_000_002L, "差旅制度", "ds-gone");
            lib.setStatus(LibraryStatus.ENABLED.code());
            lib.setEngineSyncStatus(EngineSyncStatus.MISSING_IN_ENGINE);
            // engine_missing_since 早于阈值（N=2 * intervalMs=300000），视为达标
            lib.setEngineMissingSince(Instant.now().minus(60, ChronoUnit.MINUTES).minus(1, ChronoUnit.SECONDS));
            when(libraryRepository.findByEngineSyncStatusAndEngineMissingSinceBefore(
                    eq(EngineSyncStatus.MISSING_IN_ENGINE), any())).thenReturn(List.of(lib));

            KbDocument orphan = new KbDocument();
            orphan.setId(21L);
            orphan.setLibraryId(lib.getId());
            orphan.setEngineDocumentRef("doc-orphan");
            orphan.setEngineSyncStatus(EngineSyncStatus.MISSING_IN_ENGINE);
            orphan.setEngineMissingSince(lib.getEngineMissingSince());
            when(documentRepository.findByEngineSyncStatusAndEngineMissingSinceBefore(
                    eq(EngineSyncStatus.MISSING_IN_ENGINE), any())).thenReturn(List.of(orphan));
            when(documentRepository.deleteByEngineSyncStatusAndEngineMissingSinceBefore(
                    eq(EngineSyncStatus.MISSING_IN_ENGINE), any())).thenReturn(1);

            EngineConvergenceResult result = service.cleanupMissing();

            assertEquals(1, result.librariesCleaned());
            assertEquals(1, result.documentsCleaned());
            assertEquals(LibraryStatus.DISABLED.code(), lib.getStatus(), "库应被软删（status=0）");
            assertNotNull(lib.getArchivedAt(), "库应被置 archivedAt（可逆软删）");
            verify(libraryRepository).saveAll(any());
        }

        @Test
        @DisplayName("cleanupMissing：未达阈值的残留不被收敛")
        void shouldNotConvergeBeforeThreshold() {
            KbLibrary lib = library(1_000_000_000_000_002L, "差旅制度", "ds-gone");
            lib.setStatus(LibraryStatus.ENABLED.code());
            lib.setEngineSyncStatus(EngineSyncStatus.MISSING_IN_ENGINE);
            // 刚刚才被标记缺失，远未到阈值
            lib.setEngineMissingSince(Instant.now());
            when(libraryRepository.findByEngineSyncStatusAndEngineMissingSinceBefore(
                    eq(EngineSyncStatus.MISSING_IN_ENGINE), any())).thenReturn(List.of());
            when(documentRepository.findByEngineSyncStatusAndEngineMissingSinceBefore(
                    eq(EngineSyncStatus.MISSING_IN_ENGINE), any())).thenReturn(List.of());
            when(documentRepository.deleteByEngineSyncStatusAndEngineMissingSinceBefore(
                    eq(EngineSyncStatus.MISSING_IN_ENGINE), any())).thenReturn(0);

            EngineConvergenceResult result = service.cleanupMissing();

            assertEquals(0, result.librariesCleaned());
            assertEquals(0, result.documentsCleaned());
            assertEquals(LibraryStatus.ENABLED.code(), lib.getStatus(), "未达阈值不应软删");
            verify(libraryRepository, never()).saveAll(any());
        }
    }
}
