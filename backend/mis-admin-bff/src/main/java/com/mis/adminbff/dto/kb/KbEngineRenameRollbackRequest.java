package com.mis.adminbff.dto.kb;

import jakarta.validation.constraints.NotBlank;

/**
 * 存量 dataset 重命名回滚请求（P1-T4，BFF 入参）。
 *
 * @param batchId 原执行批次号
 */
public record KbEngineRenameRollbackRequest(@NotBlank String batchId) {
}
