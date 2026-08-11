package com.mis.adminbff.dto.kb;

import java.util.List;

/**
 * 存量 dataset 批量重命名结果（P1-T4，BFF 透传层）。
 *
 * @param batchId       批次号 UUID
 * @param dryRun        是否仅出计划
 * @param total         参与项总数
 * @param renamed       改名成功数
 * @param skipped       跳过数
 * @param failed        失败数
 * @param items         逐项结果
 * @param engineSkipped 当前引擎不支持引擎侧改名时为 true（noop/mock 护栏）
 * @param skipReason    引擎跳过原因；未跳过为 null
 */
public record KbEngineRenameResultVO(
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
