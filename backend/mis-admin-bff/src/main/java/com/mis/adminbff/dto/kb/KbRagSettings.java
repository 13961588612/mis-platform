package com.mis.adminbff.dto.kb;

/**
 * 知识库 RAG 设置（BFF 侧镜像，字段与 mis-kb {@code RagSettings} 对齐）。
 *
 * <p>L-08 新增分块与空结果策略字段；WA-01 新增 {@code vectorSimilarityWeight}；
 * kb_settings_model_chunk（R-P0-04）末位追加 {@code rerankModelId}。
 * 企业级增强一期（KE-06/KE-07）末位追加 {@code ocrEnabled} / {@code ocrLanguage} /
 * {@code chunkOverlapTokenNum}（当前引擎不支持，只落库 + 回显 + 提示，不下发）。
 * Wave B GraphRAG PoC（T01）末位追加 {@code useKnowledgeGraph} / {@code kgBuildStatus} /
 * {@code kgBuildMessage}（图谱三字段，零 DDL 进 rag_settings_json）。
 * Wave C RAPTOR（T01）末位追加 {@code useRaptor} / {@code raptorMaxTokenNum} /
 * {@code raptorThreshold} / {@code raptorMaxCluster} / {@code raptorPrompt} /
 * {@code raptorBuildStatus} / {@code raptorBuildMessage}（RAPTOR 七字段，零 DDL 进
 * rag_settings_json）。
 * 解析器增量（T01）末位追加 {@code pageIndex} / {@code imageTableContextWindow}——
 * 对应 RAGFlow parser_config 官方键 {@code toc_extraction}（布尔，默认 true）与
 * {@code image_table_context_window}（整数，默认 256），随每次 PUT 恒下发。
 * RAG 切片参数对齐（T1）末位追加 {@code overlapPercent} / {@code autoKeywords} /
 * {@code autoQuestions}——overlap 当前引擎不支持（只落库不下发，能力翻转后才放行）；
 * 两个 auto 键为官方 naive schema 键，随每次 PUT 恒下发。
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
 * @param useKnowledgeGraph   知识图谱开关；能力 graphrag=true 前不下发（Wave B GraphRAG PoC 新增）
 * @param kgBuildStatus       图谱构建状态 none|building|ready|failed；服务端维护（Wave B GraphRAG PoC 新增）
 * @param kgBuildMessage      图谱构建消息摘要（≤200；ready 时清空）（Wave B GraphRAG PoC 新增）
 * @param useRaptor           RAPTOR 摘要开关；能力 raptor=true 前不下发（Wave C RAPTOR 新增）
 * @param raptorMaxTokenNum   RAPTOR 摘要 chunk 最大 token 数 [512,2048]，默认 1024（Wave C RAPTOR 新增）
 * @param raptorThreshold     RAPTOR 聚类相似度阈值 [0,1]，默认 0.1（Wave C RAPTOR 新增）
 * @param raptorMaxCluster    RAPTOR 最大聚类数 [1,1024]，默认 64（Wave C RAPTOR 新增）
 * @param raptorPrompt        RAPTOR 递归摘要提示词（≤2000）（Wave C RAPTOR 新增）
 * @param raptorBuildStatus   RAPTOR 构建状态 none|building|ready|failed；服务端维护（Wave C RAPTOR 新增）
 * @param raptorBuildMessage  RAPTOR 构建消息摘要（≤200；ready 时清空）（Wave C RAPTOR 新增）
 * @param pageIndex           页码索引/TOC 提取开关（默认 true）；下发 parser_config.toc_extraction（解析器增量新增）
 * @param imageTableContextWindow 图像/表格上下文窗口 token 数 [1,4096]，默认 256；下发 parser_config.image_table_context_window（解析器增量新增）
 * @param overlapPercent      重叠百分比 [0,100]，默认 0；能力 parser_overlap=true 前不下发（T1 切片参数对齐新增）
 * @param autoKeywords        自动关键字提取数量（0=关闭，0~32，默认 0）；下发 parser_config.auto_keywords（T1 切片参数对齐新增）
 * @param autoQuestions       自动问题提取数量（0=关闭，0~10，默认 0）；下发 parser_config.auto_questions（T1 切片参数对齐新增）
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
        Integer chunkOverlapTokenNum,
        Boolean useKnowledgeGraph,
        String kgBuildStatus,
        String kgBuildMessage,
        Boolean useRaptor,
        Integer raptorMaxTokenNum,
        Double raptorThreshold,
        Integer raptorMaxCluster,
        String raptorPrompt,
        String raptorBuildStatus,
        String raptorBuildMessage,
        Boolean pageIndex,
        Integer imageTableContextWindow,
        Double overlapPercent,
        Integer autoKeywords,
        Integer autoQuestions) {
}
