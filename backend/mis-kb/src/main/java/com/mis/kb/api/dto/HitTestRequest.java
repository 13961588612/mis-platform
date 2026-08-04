package com.mis.kb.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 命中测试请求（Q-04 / WA-07）。
 *
 * <p><b>单库</b>：命中测试是「调这一个库的参数」的工具，跨库测出来的结果没法归因
 * （多库检索参数会回落全局默认，测了也不是该库的行为），因此 {@code libraryId} 必填。
 *
 * <p>下面 5 个可选参数是<b>临时覆盖</b>：只影响本次测试，<b>不写回库级设置</b>。
 * 管理员先在这里试出满意的组合，再去 L-08 面板正式保存——这是命中测试存在的意义。
 *
 * <p><b>Wave D 新增末位字段 {@code disableSynonym}</b>（WD-11）。record 是位置参数，
 * 新字段一律追加末位——插在中间会让所有既有构造点<b>静默错位</b>，
 * 编译器不报错，因为类型恰好能对上。
 *
 * @param libraryId              目标知识库 id（必填，单库）
 * @param question               测试问题（必填）
 * @param topK                   临时覆盖召回条数
 * @param threshold              临时覆盖相似度阈值
 * @param retrievalMethod        临时覆盖检索方式 vector/keyword/hybrid
 * @param vectorSimilarityWeight 临时覆盖向量相似度权重
 * @param rerank                 临时覆盖重排开关
 * @param disableSynonym         本次测试是否不使用同义词扩展（WD-11）。
 *                               <b>只影响本次请求</b>，绝不改动
 *                               {@code kb_synonym_config.enabled} —— 这是「对照实验」用的开关，
 *                               管理员要看的是「同一个问题、开与关两次结果的差异」，
 *                               若勾一下就把全局开关关了，线上问答会跟着一起变，
 *                               那就不是对照实验而是生产事故。
 *                               {@code null} 与 {@code false} 同义（不禁用）
 */
public record HitTestRequest(
        @NotNull Long libraryId,
        @NotBlank @Size(max = 2000) String question,
        Integer topK,
        Double threshold,
        String retrievalMethod,
        Double vectorSimilarityWeight,
        Boolean rerank,
        Boolean disableSynonym) {

    /**
     * 是否本次禁用同义词扩展。
     *
     * <p>把 {@code Boolean} 三态收敛成 {@code boolean} 两态的<b>唯一</b>出口，
     * 避免调用方各写一遍 {@code Boolean.TRUE.equals(...)} 而漏掉 null。
     *
     * @return 显式传 {@code true} 才返回 {@code true}
     */
    public boolean synonymDisabledForThisRun() {
        return Boolean.TRUE.equals(disableSynonym);
    }
}
