package com.mis.kb.domain.model;

/**
 * 存量 dataset 重命名回滚请求（P1-T4）。
 *
 * @param batchId 原执行批次号（由 {@code /datasets/rename} 返回的 {@code batchId}）
 */
public record KbEngineRenameRollbackReq(String batchId) {
}
