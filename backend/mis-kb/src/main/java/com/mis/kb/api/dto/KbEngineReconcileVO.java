package com.mis.kb.api.dto;

import com.mis.kb.domain.model.EngineReconcileReport;

import java.time.Instant;
import java.util.List;

/**
 * 引擎对账报告视图（引擎删除策略 P0 / T04，契约已冻结见任务分解 §1.9）。
 *
 * <p>与领域模型 {@link EngineReconcileReport} 一一对应，单独建 VO 是为了让传输契约
 * 独立于领域演进——对账算法以后要加桶，领域模型可以先改，VO 按需跟进。
 *
 * <p><b>权限提醒：</b>本 VO 含 {@code engineLibraryRef} / {@code nativeId} 两类引擎原生 id，
 * 只能经 {@code kb:engine:reconcile} 权限码保护的端点透出，BFF 侧 {@code POST} 还要挂
 * {@code @OperLog}。别把它塞进任何列表接口。
 *
 * @param lastRunAt       最近一次对账时刻
 * @param skipped         是否跳过（当前引擎不支持对账）
 * @param skipReason      跳过原因
 * @param engineType      引擎类型
 * @param counts          差异计数
 * @param missingInEngine MIS 有 / 引擎无
 * @param orphans         引擎有 / MIS 无
 * @param nameDrift       名称漂移
 */
public record KbEngineReconcileVO(
        Instant lastRunAt,
        boolean skipped,
        String skipReason,
        String engineType,
        Counts counts,
        List<MissingItem> missingInEngine,
        List<OrphanItem> orphans,
        List<DriftItem> nameDrift) {

    /**
     * 由领域报告转换。
     *
     * @param report 对账报告，允许 {@code null}（尚未跑过）
     * @return 视图对象；入参为 {@code null} 时返回一份「未跑过」的空报告
     */
    public static KbEngineReconcileVO from(EngineReconcileReport report) {
        if (report == null) {
            return new KbEngineReconcileVO(null, false, null, null,
                    new Counts(0, 0, 0, 0, 0, 0), List.of(), List.of(), List.of());
        }
        EngineReconcileReport.Counts c = report.counts();
        return new KbEngineReconcileVO(
                report.lastRunAt(),
                report.skipped(),
                report.skipReason(),
                report.engineType(),
                new Counts(c.total(), c.consistent(), c.missingInEngine(), c.orphan(), c.nameDrift(), c.resolved()),
                report.missingInEngine().stream()
                        .map(m -> new MissingItem(m.libraryId(), m.name(), m.engineLibraryRef()))
                        .toList(),
                report.orphans().stream()
                        .map(o -> new OrphanItem(o.nativeId(), o.nativeName(), o.docCount(),
                                o.firstSeenAt(), o.lastSeenAt()))
                        .toList(),
                report.nameDrift().stream()
                        .map(d -> new DriftItem(d.libraryId(), d.name(), d.expectedName(), d.actualName()))
                        .toList());
    }

    /**
     * 差异计数。
     *
     * @param total           参与比对的库总数
     * @param consistent      一致
     * @param missingInEngine 引擎缺失
     * @param orphan          游离 dataset
     * @param nameDrift       名称漂移
     */
    public record Counts(
            int total,
            int consistent,
            int missingInEngine,
            int orphan,
            int nameDrift,
            int resolved) {
    }

    /**
     * 引擎缺失明细项。
     *
     * @param libraryId        MIS 库 ID
     * @param name             MIS 库名
     * @param engineLibraryRef 失效的引擎 dataset id
     */
    public record MissingItem(Long libraryId, String name, String engineLibraryRef) {
    }

    /**
     * 游离 dataset 明细项。
     *
     * @param nativeId    引擎原生 dataset id
     * @param nativeName  引擎侧 dataset 名
     * @param docCount    引擎侧文档数
     * @param firstSeenAt 首次发现时刻
     * @param lastSeenAt  最近一次仍可见时刻
     */
    public record OrphanItem(
            String nativeId,
            String nativeName,
            Integer docCount,
            Instant firstSeenAt,
            Instant lastSeenAt) {
    }

    /**
     * 名称漂移明细项。
     *
     * @param libraryId    MIS 库 ID
     * @param name         MIS 库名
     * @param expectedName 期望 dataset 名
     * @param actualName   实际 dataset 名
     */
    public record DriftItem(Long libraryId, String name, String expectedName, String actualName) {
    }
}
