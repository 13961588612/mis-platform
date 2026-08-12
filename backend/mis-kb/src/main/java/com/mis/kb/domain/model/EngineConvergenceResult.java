package com.mis.kb.domain.model;

import java.time.Instant;

/**
 * 单边删除收敛结果（库级 + 文档级本地残留清理，T04）。
 *
 * <p>由 {@code KbEngineReconcileService.cleanupMissing()}（人工端点）或
 * {@code applyConvergence()}(定时 auto-clean 模式) 返回，供端点映射为 VO 透出。
 *
 * @param librariesCleaned 本轮软删（status=0 + archivedAt=now，可逆）的库数量
 * @param documentsCleaned 本轮物理删除的孤儿文档数量
 * @param at               收敛执行时刻
 */
public record EngineConvergenceResult(int librariesCleaned, int documentsCleaned, Instant at) {
}
