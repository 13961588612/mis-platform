package com.mis.adminbff.dto.kb;

/**
 * 知识库 RAG 设置（BFF 侧镜像，字段与 mis-kb {@code RagSettings} 对齐）。
 *
 * <p>L-08 新增分块与空结果策略字段。<b>本层不做默认值补齐</b>——
 * 默认值只在 mis-kb 一处定义，BFF 再补一遍必然出现两套默认值漂移。
 *
 * @param topK                召回条数
 * @param scoreThreshold      相似度阈值 [0,1]
 * @param rerank              是否重排
 * @param embeddingModel      向量模型名
 * @param retrievalMethod     检索方式 vector/keyword/hybrid
 * @param chunkMethod         分块方法（对齐 RAGFlow chunk_method）
 * @param chunkTokenNum       分块 token 数
 * @param separator           分块分隔符
 * @param emptyResultStrategy 空结果策略 SUGGEST/EMPTY/TRANSFER
 * @param vectorSimilarityWeight 向量相似度权重 [0,1]，仅 hybrid 生效（WA-01 新增）
 */
public record KbRagSettings(
        Integer topK,
        Double scoreThreshold,
        Boolean rerank,
        String embeddingModel,
        String retrievalMethod,
        String chunkMethod,
        Integer chunkTokenNum,
        String separator,
        String emptyResultStrategy,
        Double vectorSimilarityWeight) {
}
