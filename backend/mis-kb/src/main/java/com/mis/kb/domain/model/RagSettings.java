package com.mis.kb.domain.model;

/**
 * 知识库 RAG 设置（序列化为 {@code kb_library.rag_settings_json}）。
 *
 * <p>参数层级（全局默认 → 库设置 → 单次问答覆盖）：本对象表示“库设置”层级。
 * 单次检索的实际生效参数由 {@link RetrieveQueryResolver} 统一合并产出，
 * 任何服务层<b>不得</b>自行内联判断（见设计文档 §7.2 铁律）。
 *
 * <p>V15 增量新增 4 个字段（F-06 RAG 参数配置）：{@code chunkMethod}、{@code chunkTokenNum}、
 * {@code separator}、{@code emptyResultStrategy}。这 4 个字段对旧数据均为 {@code null}，
 * 反序列化后由 {@link #withDefaults()} 兜底，因此<b>无需数据回填</b>。
 *
 * <p><b>Wave A（WA-01）新增 {@code vectorSimilarityWeight}（追加末位，零 DDL）：</b>
 * 本记录整体序列化进 TEXT 列，新增字段不需要数据库迁移；存量 JSON 读出为 {@code null}，
 * 由 {@link #withDefaults()} 补 {@value #DEFAULT_VECTOR_SIMILARITY_WEIGHT}。
 * {@link com.mis.kb.support.KbJson} 已关闭 {@code FAIL_ON_UNKNOWN_PROPERTIES}，
 * 灰度期间老进程读到新字段也能正常降级解析。
 *
 * <p><b>kb_settings_model_chunk（R-P0-04）新增 {@code rerankModelId}（追加末位，零 DDL）：</b>
 * 库级重排模型 id（全限定 {@code name@provider@provider}）；{@code null} = 继承全局
 * {@code mis.kb.engine.rerank-model-id}。仅在 {@link RetrieveQueryResolver} S4 阶段
 * 参与合并链（库级值 ?? 全局值），服务层不得内联判断（设计 §7.2 Resolver 铁律）。
 * record 是位置参数，新字段<b>必须追加末位</b>——插中间会让所有既有构造点静默错位
 * （设计 §8-1 铁律）。
 *
 * <p><b>非 hybrid 时权重不清空（U8 + 主理人约束②）：</b>用户在 vector/keyword 与 hybrid
 * 之间来回切换时权重原值必须保留，<b>保存/校验路径绝不因 retrievalMethod 非 hybrid 而改写它</b>；
 * 「vector→1.0 / keyword→0.0」的强制覆写<b>只发生在检索期合并阶段</b>
 * （{@link RetrieveQueryResolver} S3），不落库。
 *
 * @param topK                   召回条数上限
 * @param scoreThreshold         相似度阈值（0~1）
 * @param rerank                 是否启用重排（模型 ID 来自全局配置 {@code mis.kb.engine.rerank-model-id}）
 * @param embeddingModel         向量模型名（下发 RAGFlow {@code embedding_model}，建库期）
 * @param retrievalMethod        检索方式 vector/keyword/hybrid（检索期由 keyword + weight 组合表达）
 * @param chunkMethod            分块方法（naive/qa/paper/book/laws/presentation/table/picture/one）
 * @param chunkTokenNum          分块 token 数
 * @param separator              分块分隔符
 * @param emptyResultStrategy    空结果策略码值（见 {@link EmptyResultStrategy}）
 * @param vectorSimilarityWeight 向量相似度权重（0~1），仅 hybrid 有意义；WA-01 新增
 * @param rerankModelId          库级重排模型 id（全限定）；null = 继承全局；kb_settings_model_chunk 新增
 */
public record RagSettings(
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
        String rerankModelId) {

    /** 默认召回条数。 */
    public static final int DEFAULT_TOP_K = 5;
    /** 默认相似度阈值。 */
    public static final double DEFAULT_SCORE_THRESHOLD = 0.2D;
    /** 默认检索方式。 */
    public static final String DEFAULT_RETRIEVAL_METHOD = "hybrid";
    /** 默认分块方法。 */
    public static final String DEFAULT_CHUNK_METHOD = "naive";
    /** 默认分块 token 数。 */
    public static final int DEFAULT_CHUNK_TOKEN_NUM = 128;
    /** 默认向量相似度权重（WA-01；hybrid 下语义 30% / 关键字 70%）。 */
    public static final double DEFAULT_VECTOR_SIMILARITY_WEIGHT = 0.3D;

    /** 检索方式码值：纯向量（语义）检索。 */
    public static final String METHOD_VECTOR = "vector";
    /** 检索方式码值：纯关键字检索。 */
    public static final String METHOD_KEYWORD = "keyword";
    /** 检索方式码值：混合检索（关键字 + 语义）。 */
    public static final String METHOD_HYBRID = "hybrid";

    /**
     * 全局默认设置（无库级配置、或多库检索回落时使用）。
     *
     * @return 一份关键字段非空的默认设置
     */
    public static RagSettings defaults() {
        return new RagSettings(
                DEFAULT_TOP_K,
                DEFAULT_SCORE_THRESHOLD,
                Boolean.FALSE,
                null,
                DEFAULT_RETRIEVAL_METHOD,
                DEFAULT_CHUNK_METHOD,
                DEFAULT_CHUNK_TOKEN_NUM,
                null,
                EmptyResultStrategy.SUGGEST.code(),
                DEFAULT_VECTOR_SIMILARITY_WEIGHT,
                null);
    }

    /**
     * 用默认值填补 null 字段，保证下游拿到的设置可直接使用。
     *
     * <p>{@code embeddingModel} 与 {@code separator} 允许保持 null——前者 null 表示
     * 沿用引擎侧默认向量模型，后者 null 表示用引擎默认分隔符；两者都不该被硬编码兜底。
     *
     * <p>{@code vectorSimilarityWeight} 只做「null → 默认值」的补齐，<b>不</b>根据
     * {@code retrievalMethod} 做任何覆写——覆写只属于检索期合并阶段。
     *
     * <p>{@code rerankModelId} 保持 {@code null}（null = 继承全局
     * {@code mis.kb.engine.rerank-model-id}，库级不指定，设计 §3.2.1）。
     *
     * @return 补齐默认值后的新实例（本记录不可变，原实例不受影响）
     */
    public RagSettings withDefaults() {
        return new RagSettings(
                topK != null ? topK : DEFAULT_TOP_K,
                scoreThreshold != null ? scoreThreshold : DEFAULT_SCORE_THRESHOLD,
                rerank != null ? rerank : Boolean.FALSE,
                embeddingModel,
                retrievalMethod != null && !retrievalMethod.isBlank()
                        ? retrievalMethod : DEFAULT_RETRIEVAL_METHOD,
                chunkMethod != null && !chunkMethod.isBlank()
                        ? chunkMethod : DEFAULT_CHUNK_METHOD,
                chunkTokenNum != null ? chunkTokenNum : DEFAULT_CHUNK_TOKEN_NUM,
                separator,
                EmptyResultStrategy.normalize(emptyResultStrategy),
                vectorSimilarityWeight != null
                        ? vectorSimilarityWeight : DEFAULT_VECTOR_SIMILARITY_WEIGHT,
                rerankModelId);
    }

    /**
     * 解析空结果策略枚举。
     *
     * @return 策略枚举，非法/空值回退 {@link EmptyResultStrategy#SUGGEST}
     */
    public EmptyResultStrategy emptyStrategy() {
        return EmptyResultStrategy.fromCode(emptyResultStrategy);
    }

    /**
     * 归一化后的检索方式码值。
     *
     * @return 小写去空白的码值；非法/空值回退 {@value #DEFAULT_RETRIEVAL_METHOD}
     */
    public String normalizedRetrievalMethod() {
        return normalizeRetrievalMethod(retrievalMethod);
    }

    /**
     * 是否为混合检索（关键字 + 语义）。
     *
     * <p>仅此情形下 {@code vectorSimilarityWeight} 参与实际检索。
     *
     * @return 检索方式归一化后等于 {@value #METHOD_HYBRID} 返回 {@code true}
     */
    public boolean isHybrid() {
        return METHOD_HYBRID.equals(normalizedRetrievalMethod());
    }

    /**
     * 归一化检索方式码值（静态工具，供合并器与校验层共用）。
     *
     * @param method 原始码值，可为 {@code null}
     * @return 合法码值之一；非法/空值一律回落 {@value #DEFAULT_RETRIEVAL_METHOD}
     */
    public static String normalizeRetrievalMethod(String method) {
        if (method == null || method.isBlank()) {
            return DEFAULT_RETRIEVAL_METHOD;
        }
        String lower = method.trim().toLowerCase();
        if (METHOD_VECTOR.equals(lower) || METHOD_KEYWORD.equals(lower) || METHOD_HYBRID.equals(lower)) {
            return lower;
        }
        return DEFAULT_RETRIEVAL_METHOD;
    }
}
