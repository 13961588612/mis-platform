package com.mis.adminbff.dto.kb;

import java.util.List;

/**
 * 检索生效参数回显（BFF 侧镜像，字段与 mis-kb {@code EffectiveParamsVO} 一一对齐）。
 *
 * <p>{@code source} 取值 {@code LIBRARY} / {@code GLOBAL_DEFAULT} / {@code REQUEST_OVERRIDE}，
 * 前端据此提示「本次用的是库设置 / 全局默认 / 你临时改的参数」——多库检索回落全局默认
 * 这件事必须让人看见，否则调参调半天不知道自己的库设置根本没参与。
 *
 * @param topK                   生效召回条数
 * @param threshold              生效相似度阈值
 * @param retrievalMethod        生效检索方式
 * @param vectorSimilarityWeight 生效向量相似度权重
 * @param rerank                 生效重排开关
 * @param rerankModelId          实际下发的重排模型 ID；未启用为 null
 * @param emptyResultStrategy    生效空结果策略
 * @param source                 参数来源
 * @param degradedReasons        降级原因列表
 * @param useKnowledgeGraph      图谱增强实际生效开关（Wave B GraphRAG PoC，T03，末位追加）。
 *                               命中测试页回显「本次实际生效：图谱增强 开/关（原因）」用
 */
public record KbEffectiveParamsVO(
        Integer topK,
        Double threshold,
        String retrievalMethod,
        Double vectorSimilarityWeight,
        Boolean rerank,
        String rerankModelId,
        String emptyResultStrategy,
        String source,
        List<String> degradedReasons,
        Boolean useKnowledgeGraph) {
}
