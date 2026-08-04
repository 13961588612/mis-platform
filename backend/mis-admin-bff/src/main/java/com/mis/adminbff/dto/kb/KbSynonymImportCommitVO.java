package com.mis.adminbff.dto.kb;

/**
 * 导入提交回执（BFF 侧镜像，字段与 mis-kb {@code SynonymImportCommitVO} 一一对齐）。
 *
 * <p>Wave D 新增，纯透传。这三个计数与预检报告承诺的数字一致——
 * 因为提交阶段严格照 {@code plan_json} 执行、不重新判定，而「预检后词表被改」
 * 由 {@code dict_version} 校验挡在门外（40930）。
 *
 * @param batchId      批次 ID
 * @param createdCount 实际新增组数
 * @param mergedCount  实际并入组数
 * @param skippedCount 实际跳过行数
 */
public record KbSynonymImportCommitVO(
        Long batchId,
        Integer createdCount,
        Integer mergedCount,
        Integer skippedCount) {
}
