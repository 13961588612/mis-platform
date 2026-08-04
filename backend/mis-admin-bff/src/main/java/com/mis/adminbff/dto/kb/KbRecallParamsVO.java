package com.mis.adminbff.dto.kb;

/**
 * 召回参数快照（A-02a，BFF 侧镜像）。
 *
 * <p><b>口径说明：</b>P1 没有为每次问答单独落库召回参数，这里返回的是
 * 「命中知识库<b>当前</b>的 RAG 设置」，属于近似值。若问答之后管理员改过参数，
 * 展示值与当时实际生效值会不一致。真正的逐次快照需要新增落库字段，排在 P2。
 *
 * <p><b>Wave A 补齐 {@code vectorSimilarityWeight}</b>：mis-kb 侧 {@code RecallParamsVO}
 * 已随 WA-01 增加该字段，BFF 若不镜像，前端拿到的就是 undefined——
 * 运营看到的「召回参数」与工程师在命中测试页看到的「生效参数」会对不上账。
 *
 * @param topK                   召回条数
 * @param scoreThreshold         相似度阈值
 * @param rerank                 是否重排
 * @param retrievalMethod        检索方式
 * @param vectorSimilarityWeight 向量相似度权重（仅 hybrid 有意义）
 */
public record KbRecallParamsVO(
        Integer topK,
        Double scoreThreshold,
        Boolean rerank,
        String retrievalMethod,
        Double vectorSimilarityWeight) {
}
