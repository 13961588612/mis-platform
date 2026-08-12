package com.mis.kb.domain.model;

import java.time.Instant;
import java.util.List;

/**
 * 引擎对账报告（引擎删除策略 P0 / T04）。
 *
 * <p>把「MIS 与引擎不一致」从看不见变成看得见。由 {@code KbEngineReconcileService} 在每次
 * 对账（定时 / 手动）后生成；最近一份缓存在内存，进程重启后可由 DB 重算 counts。
 *
 * <p><b>库级 + 文档级（增量 P1 / T03）：</b>除库级四桶（一致 / 引擎缺失 / 游离 / 名称漂移）
 * 外，新增文档级缺失（MIS 有文档 / 引擎无）。文档缺失不另占独立桶位，单列
 * {@code documentMissingInEngine} 计数与明细。
 *
 * <p>设计要点：
 * <ul>
 *   <li>{@code skipped=true} 时（noop/mock 引擎）{@code counts} 与所有明细列表一律空——
 *       此路径<b>一个字段都不写库</b>（§1.10-1）。空列表的 {@code listLibraries()}/null 的
 *       {@code listDocuments()} 若直接参与比对，会把全库 {@code engine_sync_status} 刷成 2；</li>
 *   <li>明细里的 {@code engineLibraryRef} / {@code nativeId} / {@code engineDocumentRef} 属 F8
 *       红线信息，靠 {@code kb:engine:reconcile} 权限码 + BFF 审计保护，<b>不得</b>并入任何
 *       无权限保护的接口。</li>
 * </ul>
 *
 * @param lastRunAt                 最近一次对账开始时刻；从未跑过为 {@code null}
 * @param skipped                   是否跳过（当前引擎不支持对账）
 * @param skipReason                跳过原因；未跳过为 {@code null}
 * @param engineType                实际参与比对的引擎类型；跳过时为 {@code null}
 * @param counts                    各类差异计数
 * @param missingInEngine           MIS 有 / 引擎无 的库明细
 * @param orphans                   引擎有 / MIS 无 的游离 dataset 明细
 * @param nameDrift                 名称漂移的库明细
 * @param documentMissingInEngine   文档级缺失数量（MIS 有文档 / 引擎无）
 * @param documentMissingDetails     文档级缺失明细
 */
public record EngineReconcileReport(
        Instant lastRunAt,
        boolean skipped,
        String skipReason,
        String engineType,
        Counts counts,
        List<MissingInEngine> missingInEngine,
        List<Orphan> orphans,
        List<NameDrift> nameDrift,
        int documentMissingInEngine,
        List<DocumentMissingItem> documentMissingDetails) {

    /**
     * 「跳过」报告（noop/mock 引擎专用，调用方据此原样返回、不做任何写库）。
     *
     * @param at     判定时刻
     * @param reason 跳过原因（前端整块展示这句，而不是报错）
     * @return 计数全 0、明细全空的报告
     */
    public static EngineReconcileReport skipped(Instant at, String reason) {
        return new EngineReconcileReport(at, true, reason, null,
                Counts.zero(), List.of(), List.of(), List.of(), 0, List.of());
    }

    /**
     * 正常报告。
     *
     * @param at                      对账开始时刻
     * @param engineType              引擎类型
     * @param counts                  差异计数
     * @param missingInEngine         引擎缺失明细
     * @param orphans                 游离 dataset 明细
     * @param nameDrift               名称漂移明细
     * @param documentMissingInEngine 文档级缺失数量
     * @param documentMissingDetails  文档级缺失明细
     * @return 报告
     */
    public static EngineReconcileReport done(
            Instant at, String engineType, Counts counts,
            List<MissingInEngine> missingInEngine,
            List<Orphan> orphans,
            List<NameDrift> nameDrift,
            int documentMissingInEngine,
            List<DocumentMissingItem> documentMissingDetails) {
        return new EngineReconcileReport(at, false, null, engineType, counts,
                List.copyOf(missingInEngine), List.copyOf(orphans), List.copyOf(nameDrift),
                documentMissingInEngine, List.copyOf(documentMissingDetails));
    }

    /**
     * 差异计数。
     *
     * @param total           参与比对的 MIS 库总数（{@code engine_library_ref} 非空）
     * @param consistent      引擎侧存在且名称符合期望
     * @param missingInEngine MIS 有 / 引擎无
     * @param orphan          引擎有 / MIS 无（{@code kb_engine_orphan} 中 {@code resolved=0} 的行数）
     * @param nameDrift       名称漂移或同步失败
     * @param resolved        已被人工处置（认领/忽略）的游离项数量（P1-T3 新增）
     */
    public record Counts(
            int total,
            int consistent,
            int missingInEngine,
            int orphan,
            int nameDrift,
            int resolved) {

        /** 全零计数（跳过路径用）。 */
        public static Counts zero() {
            return new Counts(0, 0, 0, 0, 0, 0);
        }
    }

    /**
     * MIS 有 / 引擎无 的库明细。
     *
     * @param libraryId        MIS 库 ID
     * @param name             MIS 库名
     * @param engineLibraryRef 失效的引擎 dataset id
     */
    public record MissingInEngine(Long libraryId, String name, String engineLibraryRef) {
    }

    /**
     * 引擎侧游离 dataset 明细。
     *
     * @param nativeId    引擎原生 dataset id
     * @param nativeName  引擎侧 dataset 名
     * @param docCount    引擎侧文档数，未知为 {@code null}
     * @param firstSeenAt 首次发现时刻
     * @param lastSeenAt  最近一次仍可见的时刻
     */
    public record Orphan(
            String nativeId,
            String nativeName,
            Integer docCount,
            Instant firstSeenAt,
            Instant lastSeenAt) {
    }

    /**
     * 名称漂移明细。
     *
     * @param libraryId    MIS 库 ID
     * @param name         MIS 库名
     * @param expectedName 按命名规范算出的期望 dataset 名
     * @param actualName   引擎侧实际 dataset 名
     */
    public record NameDrift(Long libraryId, String name, String expectedName, String actualName) {
    }

    /**
     * MIS 有 / 引擎无 的文档明细（增量 P1 / T03）。
     *
     * @param libraryId         MIS 库 ID（便于定位所属库）
     * @param documentId        MIS 文档 ID
     * @param name              MIS 文档名（标题）
     * @param engineDocumentRef 失效的引擎 document id
     */
    public record DocumentMissingItem(Long libraryId, Long documentId, String name, String engineDocumentRef) {
    }
}
