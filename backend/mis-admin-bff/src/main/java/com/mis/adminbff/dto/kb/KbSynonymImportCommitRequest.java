package com.mis.adminbff.dto.kb;

import jakarta.validation.constraints.NotBlank;

/**
 * 导入提交请求（BFF 侧镜像，导入阶段二）。
 *
 * <p>Wave D 新增，纯透传。
 *
 * <p>{@code token} 的有效性、过期与否、对应计划是否已提交过，全部由 mis-kb 判定
 * （{@code KB_SYNONYM_IMPORT_TOKEN_INVALID=40931} / {@code KB_SYNONYM_IMPORT_STALE=40930}）。
 * BFF 只挡「压根没传」这一种情况。
 *
 * @param token         阶段一预检返回的一次性凭据
 * @param mergeExisting 同名规范词的处置：{@code true} 合并别名 / {@code false} 跳过。
 *                      用原始 {@code boolean}：这里缺省成 false（跳过）是安全的保守行为，
 *                      与 {@code enabled} 那种「必须显式表态」的场景不同
 */
public record KbSynonymImportCommitRequest(
        @NotBlank(message = "预检令牌不能为空") String token,
        boolean mergeExisting) {
}
