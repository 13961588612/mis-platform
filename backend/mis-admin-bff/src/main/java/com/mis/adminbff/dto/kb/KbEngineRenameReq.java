package com.mis.adminbff.dto.kb;

/**
 * 存量 dataset 批量重命名请求（P1-T4，BFF 入参）。
 *
 * @param dryRun       是否仅出计划不落地（默认 true）
 * @param confirmToken 执行令牌，必须等于 {@code RENAME-LEGACY}
 * @param limit        单次处理上限（默认 50，上限 200）
 */
public record KbEngineRenameReq(
        Boolean dryRun,
        String confirmToken,
        Integer limit) {
}
