package com.mis.kb.domain.model;

import java.util.List;

/**
 * 存量 dataset 批量重命名结果（P1-T4）。
 *
 * @param batchId     批次号 UUID；dry-run 也生成，便于回滚时定位；跳过（非 ragflow）时为 {@code null}
 * @param dryRun      是否仅出计划未落地
 * @param total       参与项总数（含 SKIP）
 * @param renamed     实际改名成功数
 * @param skipped     跳过数（幂等已规范 / 引擎缺失 / 归档库）
 * @param failed      引擎改名失败数
 * @param items       逐项结果（按处理顺序）
 * @param engineSkipped 当前引擎不支持引擎侧改名时 {@code true}（护栏，与对账 skipped 口径一致）
 * @param skipReason  引擎跳过原因；未跳过时为 {@code null}
 */
public record KbEngineRenameResult(
        String batchId,
        boolean dryRun,
        int total,
        int renamed,
        int skipped,
        int failed,
        List<Item> items,
        boolean engineSkipped,
        String skipReason) {

    /** 单项结果。 */
    public record Item(
            Long libraryId,
            String nativeId,
            String oldName,
            String newName,
            String action,
            int status,
            String error) {
    }
}
