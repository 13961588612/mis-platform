package com.mis.adminbff.dto.kb;

import jakarta.validation.constraints.NotBlank;

/**
 * 游离 dataset 处置请求（P1-T3，BFF 入参）。
 *
 * @param action          处置动作码（bind_existing / adopt_new / ignore）
 * @param note            ignore 备注；bind/adopt 可附加说明
 * @param targetLibraryId bind_existing 目标库 ID
 * @param name            adopt_new 新库名
 * @param categoryId      adopt_new 新库分类
 * @param secrecy         adopt_new 新库密级
 * @param owner           adopt_new 新库归属人（缺省取当前用户）
 */
public record KbEngineOrphanResolveRequest(
        @NotBlank String action,
        String note,
        Long targetLibraryId,
        String name,
        Long categoryId,
        String secrecy,
        Long owner) {
}
