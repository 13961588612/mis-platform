package com.mis.adminbff.dto.kb;

import java.time.Instant;
import java.util.List;

/**
 * 引擎对账报告（BFF 侧镜像，引擎删除策略 P0 / T04）。
 *
 * <p>字段与 mis-kb 的同名 VO 一一对齐，BFF 纯透传。{@code skipped=true} 时前端整块显示
 * 「当前引擎不支持对账」而不是报错——noop 环境（本地开发、CI）是常态，不该满屏红。
 *
 * @param lastRunAt       最近一次对账时刻；从未跑过为 {@code null}
 * @param skipped         是否跳过
 * @param skipReason      跳过原因
 * @param engineType      引擎类型
 * @param counts          差异计数
 * @param missingInEngine MIS 有 / 引擎无
 * @param orphans         引擎有 / MIS 无
 * @param nameDrift       名称漂移
 */
public record KbEngineReconcileVO(
        Instant lastRunAt,
        Boolean skipped,
        String skipReason,
        String engineType,
        Counts counts,
        List<MissingItem> missingInEngine,
        List<OrphanItem> orphans,
        List<DriftItem> nameDrift) {

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
            Integer total,
            Integer consistent,
            Integer missingInEngine,
            Integer orphan,
            Integer nameDrift) {
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
     * @param actualName   实际 dataset 名；由 DB 重算的报告里为 {@code null}
     */
    public record DriftItem(Long libraryId, String name, String expectedName, String actualName) {
    }
}
