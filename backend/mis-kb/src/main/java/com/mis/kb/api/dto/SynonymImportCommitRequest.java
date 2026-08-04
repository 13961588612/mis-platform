package com.mis.kb.api.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 导入提交请求（Wave D · T09，WD-04 阶段二）。
 *
 * <p><b>请求体里没有文件，只有 {@link #token}</b>——这正是两段式导入的要点：
 * 文件在预检阶段已被解析成 {@code plan_json} 落库，提交阶段严格照计划执行，
 * <b>不重新解析、不重新判定</b>。若这里再传一次文件，就会出现「用户第二次传的文件
 * 与他刚才看过的那份报告不是同一个」这种无法防御的错位。
 *
 * <p>{@link #mergeExisting} 对应预检面板上那个「同名规范词如何处置」的开关：
 * <ul>
 *   <li>{@code true} —— 把文件里的别名<b>并入</b>已存在的同名组；</li>
 *   <li>{@code false} —— 这些行<b>跳过</b>，计入回执的 {@code skippedCount}。</li>
 * </ul>
 * 它是<b>用户主动表达的意图</b>，因此由前端在提交时回传，而不是在预检时固化进计划：
 * 管理员看完报告才知道有多少行会被合并，此时才有足够信息做这个决定。
 *
 * <p>用原始 {@code boolean} 而非 {@code Boolean}：字段缺失时回落 {@code false}
 * （即「跳过」）是<b>安全侧</b>的默认——宁可少并入几个别名让用户再来一次，
 * 也不要因为一个丢失的字段就把别名合进了他没打算动的组。
 *
 * @param token         预检令牌（必填，一次性）
 * @param mergeExisting 同名规范词是否合并；缺省 {@code false}（跳过）
 */
public record SynonymImportCommitRequest(
        @NotBlank(message = "预检令牌不能为空") String token,
        boolean mergeExisting) {
}
