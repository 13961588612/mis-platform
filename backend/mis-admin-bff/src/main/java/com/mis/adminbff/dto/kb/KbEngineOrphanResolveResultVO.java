package com.mis.adminbff.dto.kb;

/**
 * 游离 dataset 处置结果（P1-T3，BFF 透传层）。
 *
 * @param nativeId        被处置的引擎 dataset id
 * @param engineType      引擎类型
 * @param action          实际执行的动作码
 * @param libraryId       处置后关联的 MIS 库 ID（ignore 为 {@code null}）
 * @param engineSyncFailed 引擎侧改名是否失败（失败仍视为处置成功）
 * @param message         面向操作者的提示
 */
public record KbEngineOrphanResolveResultVO(
        String nativeId,
        String engineType,
        String action,
        Long libraryId,
        boolean engineSyncFailed,
        String message) {
}
