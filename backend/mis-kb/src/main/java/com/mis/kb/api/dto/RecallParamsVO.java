package com.mis.kb.api.dto;

import com.mis.kb.domain.model.RagSettings;

/**
 * 会话详情中的召回参数快照（A-02a）。
 *
 * <p>运营排障时需要知道「这条回答是用什么参数召回的」。P1 尚未按会话持久化参数快照，
 * 因此这里取<b>当前生效的库级设置</b>作为近似值——若期间管理员改过参数，
 * 展示的会是改后的值。此口径已在类注释与前端提示中标明，P2 若要精确回溯，
 * 需在 {@code kb_qa_message} 增加 {@code recall_params_json} 快照列。
 *
 * <p><b>Wave A 扩展：</b>补 {@code rerank} 与 {@code vectorSimilarityWeight}，
 * 与 {@link EffectiveParamsVO} 的字段口径对齐——运营看到的「召回参数」和工程师
 * 在命中测试页看到的「生效参数」，语义必须是同一套，否则对不上账。
 *
 * @param topK                   召回条数
 * @param scoreThreshold         相似度阈值
 * @param embeddingModel         向量模型名
 * @param retrievalMethod        检索方式
 * @param rerank                 是否启用重排
 * @param vectorSimilarityWeight 向量相似度权重（仅 hybrid 有意义）
 */
public record RecallParamsVO(
        Integer topK,
        Double scoreThreshold,
        String embeddingModel,
        String retrievalMethod,
        Boolean rerank,
        Double vectorSimilarityWeight) {

    /**
     * 由库级 RAG 设置构造召回参数快照。
     *
     * @param settings 库级设置；{@code null} 时回落全局默认
     * @return 召回参数视图
     */
    public static RecallParamsVO from(RagSettings settings) {
        RagSettings effective = (settings == null ? RagSettings.defaults() : settings).withDefaults();
        return new RecallParamsVO(
                effective.topK(),
                effective.scoreThreshold(),
                effective.embeddingModel(),
                effective.retrievalMethod(),
                effective.rerank(),
                effective.vectorSimilarityWeight());
    }
}
