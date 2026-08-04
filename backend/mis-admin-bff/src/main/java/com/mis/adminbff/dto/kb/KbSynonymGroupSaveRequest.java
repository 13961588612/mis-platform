package com.mis.adminbff.dto.kb;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * 术语组保存请求（BFF 侧镜像，新建与编辑共用）。
 *
 * <p>Wave D 新增，纯透传到 mis-kb {@code SynonymGroupSaveRequest}。
 *
 * <p><b>{@link #terms} 是「别名列表」，不含规范词。</b>这一点前端契约
 * （{@code SynonymGroupSavePayload}）与 mis-kb 服务层 {@code mergeTerms(canonical, aliases)}
 * 已经对齐，BFF 这层若自作主张把 {@code canonicalTerm} 塞进去，
 * 下游会得到一个「规范词出现两次」的列表——去重逻辑虽能兜住，
 * 但 {@code sortNo} 会错位，用户拖拽排的序当场失效。
 *
 * <p><b>{@link #terms} 的顺序即语义</b>：它决定预算截断时谁先入选，原样透传不排序。
 *
 * <p>这里只做「必填 + 长度」这类无争议的形式校验。词条冲突（40927）、
 * 规范词重复、词条数上限等业务判定一律由 mis-kb 裁定——
 * 判权和判业务分居两处，是让规则只有一个定义点。
 *
 * @param canonicalTerm 规范词原文（必填）
 * @param terms         有序<b>别名</b>列表；可为 {@code null}（等价于空列表）
 * @param remark        备注
 * @param status        1=启用 0=停用
 */
public record KbSynonymGroupSaveRequest(
        @NotBlank(message = "规范词不能为空")
        @Size(max = 128, message = "规范词长度不能超过 128 个字符")
        String canonicalTerm,

        List<String> terms,

        @Size(max = 512, message = "备注长度不能超过 512 个字符")
        String remark,

        Integer status) {

    /**
     * 别名列表，{@code null} 收敛为空列表。
     *
     * @return 恒非 {@code null} 的别名列表
     */
    public List<String> termsOrEmpty() {
        return terms == null ? List.of() : terms;
    }
}
