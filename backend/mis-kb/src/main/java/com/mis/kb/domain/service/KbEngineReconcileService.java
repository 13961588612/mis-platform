package com.mis.kb.domain.service;

import com.mis.kb.config.ShedLockConfig;
import com.mis.kb.domain.entity.KbEngineOrphan;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.EngineLibraryBrief;
import com.mis.kb.domain.model.EngineReconcileReport;
import com.mis.kb.domain.model.EngineSyncStatus;
import com.mis.kb.domain.repository.KbEngineOrphanRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.engine.RagflowDatasetNaming;
import com.mis.kb.engine.RagflowProperties;
import com.mis.kb.support.IdGenerator;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 引擎对账服务（引擎删除策略 P0 / T04）。
 *
 * <p><b>要解决的问题：</b>MIS 的 {@code kb_library.engine_library_ref} 与 RAGFlow 侧
 * dataset 是一对「没有外键约束的跨系统引用」。引擎侧被人手工删了库、改了名，或 MIS 侧
 * 建库时引擎调用半途失败，两边就会悄悄劈叉——直到某天用户检索不出东西才被发现。
 * 本服务定期把两边拉平比对，把差异显式记录下来。
 *
 * <p><b>四类判定：</b>
 * <table border="1">
 *   <caption>比对结果</caption>
 *   <tr><th>情形</th><th>落库位置</th></tr>
 *   <tr><td>MIS 有 / 引擎无</td><td>{@code kb_library.engine_sync_status=2}</td></tr>
 *   <tr><td>引擎有 / MIS 无</td><td>{@code kb_engine_orphan} upsert（无 kb_library 行可落）</td></tr>
 *   <tr><td>名称与期望名不符</td><td>{@code kb_library.engine_sync_status=3}</td></tr>
 *   <tr><td>一致</td><td>{@code kb_library.engine_sync_status=1}</td></tr>
 * </table>
 *
 * <p><b>护栏（勿删）：</b>入口第一行判 {@code type != ragflow} 直接 {@code skipped}。
 * noop/mock 的 {@code listLibraries()} 返回空列表，若放它进比对逻辑，
 * 一次对账就会把全库 {@code engine_sync_status} 刷成 2（引擎缺失），前端满屏红叉。
 *
 * <p><b>事务口径：</b>刻意<b>不</b>包一个大事务。对账是逐行幂等的状态刷新，跑一次可能要
 * 分页拉几十次引擎 HTTP，把这些 IO 圈进事务会长时间占着数据库连接。改为在内存里算完，
 * 末尾用 {@code saveAll} 一次性批量落库（Spring Data 的 {@code saveAll} 自带事务）。
 */
@Service
public class KbEngineReconcileService {

    private static final Logger log = LoggerFactory.getLogger(KbEngineReconcileService.class);

    /** 游离项「待处理」标记。 */
    private static final int ORPHAN_UNRESOLVED = 0;

    /** 明细列表的展示上限——引擎侧几千个 dataset 全塞进报告会撑爆响应体。 */
    private static final int MAX_DETAIL_ITEMS = 200;

    private final KbLibraryRepository libraryRepository;
    private final KbEngineOrphanRepository orphanRepository;
    private final KbLibraryService libraryService;
    private final KnowledgeEnginePort enginePort;
    private final RagflowProperties engineProperties;

    /** 最近一次对账报告（内存缓存，重启后由 DB 重算）。 */
    private final AtomicReference<EngineReconcileReport> latest = new AtomicReference<>(null);

    public KbEngineReconcileService(
            KbLibraryRepository libraryRepository,
            KbEngineOrphanRepository orphanRepository,
            KbLibraryService libraryService,
            KnowledgeEnginePort enginePort,
            RagflowProperties engineProperties) {
        this.libraryRepository = libraryRepository;
        this.orphanRepository = orphanRepository;
        this.libraryService = libraryService;
        this.enginePort = enginePort;
        this.engineProperties = engineProperties;
    }

    /**
     * 定时对账（多实例互斥）。
     *
     * <p>{@code enabled} 用方法体第一行判断而非 {@code @ConditionalOnProperty}——后者只能
     * 重启生效，而运维需要在 Nacos 里热关。
     *
     * <p>异常一律吞掉只记 error：定时任务抛异常会被 Spring 的调度器吃掉且不再有下文，
     * 这里显式兜住，保证下一个周期照常触发。
     */
    @Scheduled(fixedDelayString = "${mis.kb.engine.reconcile.interval-ms:1800000}")
    @SchedulerLock(
            name = ShedLockConfig.LOCK_ENGINE_RECONCILE,
            lockAtMostFor = "${mis.kb.engine.reconcile.lock-at-most-for:PT10M}",
            lockAtLeastFor = "${mis.kb.engine.reconcile.lock-at-least-for:PT30S}")
    public void scheduledReconcile() {
        if (!engineProperties.getReconcile().isEnabled()) {
            log.debug("引擎对账开关已关闭（mis.kb.engine.reconcile.enabled=false），跳过本轮");
            return;
        }
        try {
            EngineReconcileReport report = reconcile();
            if (!report.skipped()) {
                log.info("引擎对账完成：总数={} 一致={} 引擎缺失={} 游离={} 名称漂移={}",
                        report.counts().total(), report.counts().consistent(),
                        report.counts().missingInEngine(), report.counts().orphan(),
                        report.counts().nameDrift());
            }
        } catch (Exception e) {
            log.error("引擎对账执行失败（下一周期将重试）: {}", e.getMessage(), e);
        }
    }

    /**
     * 执行一次对账（手动触发端点与定时任务共用）。
     *
     * @return 本次对账报告；引擎不支持时返回 {@code skipped=true} 且不写任何库
     */
    public EngineReconcileReport reconcile() {
        Instant startedAt = Instant.now();
        if (!engineProperties.isRagflow()) {
            EngineReconcileReport report = EngineReconcileReport.skipped(
                    startedAt, "当前引擎（" + engineProperties.getType() + "）不支持对账");
            latest.set(report);
            return report;
        }

        String engineType = enginePort.engineType();
        // 引擎侧全量 dataset：nativeId -> brief。用 LinkedHashMap 保序，便于日志与明细稳定。
        Map<String, EngineLibraryBrief> engineSide = new LinkedHashMap<>();
        for (EngineLibraryBrief brief : enginePort.listLibraries()) {
            if (brief != null && StringUtils.hasText(brief.nativeId())) {
                engineSide.put(brief.nativeId(), brief);
            }
        }

        List<KbLibrary> bound = libraryRepository.findAll().stream()
                .filter(lib -> StringUtils.hasText(lib.getEngineLibraryRef()))
                .toList();

        List<EngineReconcileReport.MissingInEngine> missing = new ArrayList<>();
        List<EngineReconcileReport.NameDrift> drift = new ArrayList<>();
        int consistent = 0;

        for (KbLibrary lib : bound) {
            EngineLibraryBrief brief = engineSide.remove(lib.getEngineLibraryRef());
            lib.setEngineCheckedAt(startedAt);
            if (brief == null) {
                lib.setEngineSyncStatus(EngineSyncStatus.MISSING_IN_ENGINE);
                if (missing.size() < MAX_DETAIL_ITEMS) {
                    missing.add(new EngineReconcileReport.MissingInEngine(
                            lib.getId(), lib.getName(), lib.getEngineLibraryRef()));
                }
                continue;
            }
            String actualName = brief.name() == null ? "" : brief.name().trim();
            if (nameMatches(lib, actualName)) {
                lib.setEngineSyncStatus(EngineSyncStatus.CONSISTENT);
                consistent++;
            } else {
                lib.setEngineSyncStatus(EngineSyncStatus.DRIFT_OR_FAILED);
                if (drift.size() < MAX_DETAIL_ITEMS) {
                    drift.add(new EngineReconcileReport.NameDrift(
                            lib.getId(), lib.getName(), expectedName(lib), actualName));
                }
            }
        }
        if (!bound.isEmpty()) {
            libraryRepository.saveAll(bound);
        }

        // 剩在 engineSide 里的就是「引擎有 / MIS 无」
        List<KbEngineOrphan> orphanRows = upsertOrphans(engineType, engineSide.values(), startedAt);
        List<EngineReconcileReport.Orphan> orphans = orphanRows.stream()
                .limit(MAX_DETAIL_ITEMS)
                .map(o -> new EngineReconcileReport.Orphan(
                        o.getNativeId(), o.getNativeName(), o.getDocCount(),
                        o.getFirstSeenAt(), o.getLastSeenAt()))
                .toList();

        EngineReconcileReport report = EngineReconcileReport.done(
                startedAt, engineType,
                new EngineReconcileReport.Counts(
                        bound.size(), consistent, missing.size(), orphanRows.size(), drift.size()),
                missing, orphans, drift);
        latest.set(report);
        return report;
    }

    /**
     * 读取最近一次对账报告。
     *
     * <p>进程重启后内存缓存为空，此时用 DB 现有状态重算一份（{@code lastRunAt=null}
     * 表示「本进程还没跑过，以下是库里的存量结论」）——总比给运维一个空白页强。
     *
     * @return 最近报告，恒非 {@code null}
     */
    public EngineReconcileReport latestReport() {
        EngineReconcileReport cached = latest.get();
        if (cached != null) {
            return cached;
        }
        if (!engineProperties.isRagflow()) {
            return EngineReconcileReport.skipped(
                    null, "当前引擎（" + engineProperties.getType() + "）不支持对账");
        }
        return rebuildFromDb();
    }

    // ---------------------------------------------------------------- 内部

    /**
     * 引擎侧实际名是否符合期望。
     *
     * <p><b>已归档库单独判：</b>归档名带日期前缀（{@code [已归档-20260811]-xxx}），
     * 若拿「今天的日期」去精确比对，昨天归档的库明天就会被判成漂移，报告里天天一片黄。
     * 故已归档库只要求带合法归档前缀即可。
     */
    private boolean nameMatches(KbLibrary lib, String actualName) {
        if (!StringUtils.hasText(actualName)) {
            return false;
        }
        if (lib.isArchived()) {
            return RagflowDatasetNaming.isArchivedName(actualName);
        }
        return Objects.equals(actualName, libraryService.expectedEngineName(lib));
    }

    /** 用于明细展示的期望名（已归档库展示带归档前缀的形态）。 */
    private String expectedName(KbLibrary lib) {
        String base = libraryService.expectedEngineName(lib);
        return lib.isArchived() ? RagflowDatasetNaming.forArchive(base, null) : base;
    }

    /**
     * 游离 dataset upsert：{@code firstSeenAt} 首次发现后不再变，{@code lastSeenAt} 每次刷新。
     *
     * <p>返回的是<b>该引擎下全部待处理游离项</b>（不只是本次新发现的），因为报告要展示
     * 完整的待处理清单。已被 MIS 重新认领（本次比对中匹配上了）的行会被置 {@code resolved=1}，
     * 避免历史脏行永远挂在报告里。
     */
    private List<KbEngineOrphan> upsertOrphans(
            String engineType, java.util.Collection<EngineLibraryBrief> unmatched, Instant now) {
        List<KbEngineOrphan> touched = new ArrayList<>();
        for (EngineLibraryBrief brief : unmatched) {
            KbEngineOrphan row = orphanRepository
                    .findByEngineTypeAndNativeId(engineType, brief.nativeId())
                    .orElseGet(() -> {
                        KbEngineOrphan created = new KbEngineOrphan();
                        created.setId(IdGenerator.nextId());
                        created.setEngineType(engineType);
                        created.setNativeId(brief.nativeId());
                        created.setFirstSeenAt(now);
                        return created;
                    });
            row.setNativeName(brief.name());
            row.setDocCount(brief.documentCount());
            row.setLastSeenAt(now);
            row.setResolved(ORPHAN_UNRESOLVED);
            touched.add(row);
        }
        if (!touched.isEmpty()) {
            orphanRepository.saveAll(touched);
        }

        // 本轮没再出现的历史游离项：要么引擎侧已被清理，要么已被 MIS 重新绑定，标记为已处理
        List<KbEngineOrphan> stale = orphanRepository
                .findByEngineTypeAndResolvedOrderByLastSeenAtDesc(engineType, ORPHAN_UNRESOLVED)
                .stream()
                .filter(row -> row.getLastSeenAt() == null || row.getLastSeenAt().isBefore(now))
                .toList();
        if (!stale.isEmpty()) {
            stale.forEach(row -> {
                row.setResolved(1);
                row.setNote("对账时引擎侧已不存在或已被 MIS 重新绑定，自动关闭");
            });
            orphanRepository.saveAll(stale);
            log.info("引擎对账：自动关闭已消失的游离 dataset {} 条", stale.size());
        }
        return touched;
    }

    /**
     * 进程重启后用 DB 现状重算报告。
     *
     * <p>{@code kb_library} 量级是百级，全量拉回内存分桶完全够用，不值得为此加索引与专用查询。
     */
    private EngineReconcileReport rebuildFromDb() {
        String engineType = enginePort.engineType();
        List<KbLibrary> bound = libraryRepository.findAll().stream()
                .filter(lib -> StringUtils.hasText(lib.getEngineLibraryRef()))
                .toList();
        List<EngineReconcileReport.MissingInEngine> missing = new ArrayList<>();
        List<EngineReconcileReport.NameDrift> drift = new ArrayList<>();
        int consistent = 0;
        for (KbLibrary lib : bound) {
            int status = lib.getEngineSyncStatus() == null
                    ? EngineSyncStatus.UNKNOWN : lib.getEngineSyncStatus();
            switch (status) {
                case EngineSyncStatus.CONSISTENT -> consistent++;
                case EngineSyncStatus.MISSING_IN_ENGINE -> {
                    if (missing.size() < MAX_DETAIL_ITEMS) {
                        missing.add(new EngineReconcileReport.MissingInEngine(
                                lib.getId(), lib.getName(), lib.getEngineLibraryRef()));
                    }
                }
                case EngineSyncStatus.DRIFT_OR_FAILED -> {
                    if (drift.size() < MAX_DETAIL_ITEMS) {
                        // 重建路径拿不到引擎侧实际名（没调引擎），actualName 留空由前端显示「未知」
                        drift.add(new EngineReconcileReport.NameDrift(
                                lib.getId(), lib.getName(), expectedName(lib), null));
                    }
                }
                default -> {
                    // UNKNOWN：从未对过账，不计入任何差异桶
                }
            }
        }
        List<KbEngineOrphan> orphanRows = orphanRepository
                .findByEngineTypeAndResolvedOrderByLastSeenAtDesc(engineType, ORPHAN_UNRESOLVED);
        List<EngineReconcileReport.Orphan> orphans = orphanRows.stream()
                .limit(MAX_DETAIL_ITEMS)
                .map(o -> new EngineReconcileReport.Orphan(
                        o.getNativeId(), o.getNativeName(), o.getDocCount(),
                        o.getFirstSeenAt(), o.getLastSeenAt()))
                .toList();
        return EngineReconcileReport.done(
                null, engineType,
                new EngineReconcileReport.Counts(
                        bound.size(), consistent, missing.size(), orphanRows.size(), drift.size()),
                missing, orphans, drift);
    }
}
