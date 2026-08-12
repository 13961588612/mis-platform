package com.mis.kb.api.dto;

import com.mis.kb.domain.model.EffectiveRetrieveParams;

import java.util.List;

/**
 * 本次检索生效参数回显（WA-02 / WA-14）。
 *
 * <p>{@link EffectiveRetrieveParams} 的对外视图。为什么要单独一层而不直接透出领域对象：
 * 领域对象随实现演进，API 契约要稳；且 {@code rerankModelId} 属平台配置，
 * 这里如实回显是为了让管理员知道「用的是哪个重排模型」，不含密钥性质信息。
 *
 * @param topK                   生效召回条数
 * @param threshold              生效相似度阈值
 * @param retrievalMethod        生效检索方式 vector/keyword/hybrid
 * @param vectorSimilarityWeight 生效向量相似度权重
 * @param rerank                 生效重排开关
 * @param rerankModelId          实际下发的重排模型 ID；未启用时为 {@code null}
 * @param emptyResultStrategy    生效空结果策略
 * @param source                 参数来源 LIBRARY / GLOBAL_DEFAULT / REQUEST_OVERRIDE
 * @param degradedReasons        降级原因列表；空表示未降级
 * @param useKnowledgeGraph      图谱增强实际生效开关（Wave B GraphRAG PoC，T03，末位追加）。
 *                               {@code true} = 本次走了 /datasets/{id}/search + use_kg:true；
 *                               被 S4.5 降级时为 {@code false}（原因在 {@code degradedReasons}）。
 *                               命中测试页据此回显「本次实际生效：图谱增强 开/关（原因）」
 * @param useRaptor              RAPTOR 摘要实际生效开关（Wave C RAPTOR，T03，末位追加）。
 *                               {@code true} = 本次请求了 RAPTOR 增强（引擎建树后 /retrieval
 *                               自动融合，MIS 检索期不改请求体）；被 S4.6 降级时为
 *                               {@code false}（原因在 {@code degradedReasons}）。
 *                               命中测试页据此回显「库已建树 / RAPTOR 未构建完成」
 */
public record EffectiveParamsVO(
        Integer topK,
        Double threshold,
        String retrievalMethod,
        Double vectorSimilarityWeight,
        Boolean rerank,
        String rerankModelId,
        String emptyResultStrategy,
        String source,
        List<String> degradedReasons,
        Boolean useKnowledgeGraph,
        Boolean useRaptor) {

    /**
     * 由领域对象构造视图。
     *
     * @param params 生效参数；{@code null} 时返回 {@code null}（响应里该字段直接缺省）
     * @return 视图对象
     */
    public static EffectiveParamsVO from(EffectiveRetrieveParams params) {
        if (params == null) {
            return null;
        }
        return new EffectiveParamsVO(
                params.topK(),
                params.threshold(),
                params.retrievalMethod(),
                params.vectorSimilarityWeight(),
                params.rerank(),
                params.rerankModelId(),
                params.emptyResultStrategy(),
                params.source(),
                params.degradedReasons(),
                params.useKnowledgeGraph(),
                params.useRaptor());
    }
}
