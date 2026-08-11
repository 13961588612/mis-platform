package com.mis.adminbff.dto.kb;

/**
 * 知识库 RAG 设置（BFF 侧镜像，字段与 mis-kb {@code RagSettings} 对齐）。
 *
 * <p>L-08 新增分块与空结果策略字段；WA-01 新增 {@code vectorSimilarityWeight}；
 * kb_settings_model_chunk（R-P0-04）末位追加 {@code rerankModelId}。
 * 企业级增强一期（KE-06/KE-07）末位追加 {@code ocrEnabled} / {@code ocrLanguage} /
 * {@code chunkOverlapTokenNum}（当前引擎不支持，只落库 + 回显 + 提示，不下发）。
 * <b>本层不做默认值补齐</b>——默认值只在 mis-kb 一处定义，BFF 再补一遍必然出现两套默认值漂移。
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
 * @param rerankModelId       库级重排模型 id（全限定）；null=继承全局；kb_settings_model_chunk 新增
 * @param ocrEnabled          OCR 开关；能力 parser_ocr=true 前不下发（企业级增强一期新增）
 * @param ocrLanguage         OCR 语言码值 zh/en/zh_en；能力支持前不下发（企业级增强一期新增）
 * @param chunkOverlapTokenNum 分块重叠 token 数（正整数；能力 parser_overlap=true 前不下发）（企业级增强一期新增）
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
        Double vectorSimilarityWeight,
        String rerankModelId,
        Boolean ocrEnabled,
        String ocrLanguage,
        Integer chunkOverlapTokenNum) {
}
