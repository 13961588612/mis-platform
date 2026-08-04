package com.mis.kb.api.dto;

/**
 * 导入提交回执（Wave D，WD-04，阶段二产物）。
 *
 * <p>字段与前端 {@code KbSynonymImportCommit} 逐字段对齐。
 *
 * <p><b>这三个计数必须与预检报告承诺的数字一致</b>（主理人 Q10 硬约束）。
 * 之所以能保证一致，是因为提交阶段<b>严格照 {@code plan_json} 执行、不重新判定</b>；
 * 而「预检之后有人改了词表」这种情况由 {@code dict_version} 校验直接挡在门外
 * （返回 40930 让管理员重新预检），而不是「静默多跳几行」——
 * 后者会让回执上的数字变成一个没人能解释的谎言。
 *
 * <p>唯一的例外是管理员在提交时把「同名规范词」的处置从「合并」切成「跳过」：
 * 此时 {@code mergedCount} 归零、这些行计入 {@code skippedCount}。
 * 这是<b>用户主动改变的意图</b>，不是系统静默行为，前端面板上就摆着这个开关。
 *
 * @param batchId      批次 ID（下载未导入行用）
 * @param createdCount 实际新增组数
 * @param mergedCount  实际并入组数
 * @param skippedCount 实际跳过行数
 */
public record SynonymImportCommitVO(
        Long batchId,
        Integer createdCount,
        Integer mergedCount,
        Integer skippedCount) {
}
