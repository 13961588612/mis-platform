package com.mis.kb.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * 术语组保存请求（Wave D · T09，WD-01 / WD-02；新建与编辑共用）。
 *
 * <p><b>字段名 {@code terms} 是前端锁定的契约</b>（{@code SynonymGroupSavePayload}），
 * 但它承载的是<b>别名列表</b>而非「全部词条」——规范词由 {@link #canonicalTerm} 单独给出，
 * 服务层再把两者合成有序词条表。名字与语义的这点错位是前端已入库的既成事实，
 * ⛔ 不要为了「看起来更对」把它改成 {@code aliases}：前端 T11-T13 已锁死并通过类型检查，
 * 改名只会换来一个 400。
 *
 * <p><b>{@link #terms} 的顺序即语义</b>：它决定 {@code sortNo}，而 {@code sortNo} 决定
 * 扩展预算不足时谁先入选。用户在表单里拖拽调序，表达的正是「哪个别名更重要」，
 * 因此服务层<b>必须保序</b>，不许排序或去重成 Set。
 *
 * <p><b>为什么不在这里做词条冲突校验</b>：唯一性是<b>全局</b>约束（跨所有术语组），
 * Bean Validation 只能看见本请求体，看不见库。冲突检测统一由
 * {@code SynonymGroupService.checkTermConflicts} 一次查库完成，抛 40927 带明细。
 *
 * @param canonicalTerm 规范词原文（必填）
 * @param terms         <b>别名</b>列表，有序；可为 {@code null} 或空（只有规范词的组是合法的，
 *                      只是不会产生任何扩展效果，预检时会给非阻断提示）
 * @param remark        备注；可为 {@code null}
 * @param status        1=启用 0=停用；{@code null} 视为启用。
 *                      <b>停用不释放词条唯一性</b>（Q3）
 */
public record SynonymGroupSaveRequest(
        @NotBlank(message = "规范词不能为空")
        @Size(max = 128, message = "规范词长度不能超过 128 个字符")
        String canonicalTerm,

        List<String> terms,

        @Size(max = 512, message = "备注长度不能超过 512 个字符")
        String remark,

        Integer status) {

    /**
     * 别名列表，恒非 {@code null}。
     *
     * <p>把 {@code null} 收敛成空列表的唯一出口，免得每个调用点都写一遍判空。
     *
     * @return 有序别名列表；未传时返回空列表
     */
    public List<String> aliasesOrEmpty() {
        return terms == null ? List.of() : terms;
    }
}
