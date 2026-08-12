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
 * <p><b>企业级增强一期（KE-06/KE-07）新增三字段（追加末位，零 DDL）：</b>
 * {@code ocrEnabled} / {@code ocrLanguage} / {@code chunkOverlapTokenNum}。
 * 当前引擎实测<b>不支持</b> OCR/overlap 键（RAGFlow parser_config 白名单不含，
 * 硬下发即 code:101/102 拒整单），故三字段<b>只落库 + 回显 + 提示</b>，
 * <b>绝不参与下发</b>（{@code RagflowAdapter} / {@code RagflowClient} 白名单天然不含）。
 * 引擎升级后翻转 {@link EngineCapabilities} 的 {@code parser_ocr} / {@code parser_overlap}
 * 能力码即放行下发，代码分支不动（设计 §1.4 / §3.2）。
 *
 * <p><b>Wave B GraphRAG PoC（T01）新增三字段（追加末位，零 DDL）：</b>
 * {@code useKnowledgeGraph} / {@code kgBuildStatus} / {@code kgBuildMessage}。
 * <ul>
 *   <li>{@code useKnowledgeGraph}（默认 {@code false}）：库级图谱开关。引擎映射两处语义不同
 *       （设计 §1.2 修正）——构图配置键 = {@code parser_config.graphrag.use_graphrag}
 *       （建库/更新期，{@code RagflowClient.updateDatasetSettings} 下发）；
 *       检索增强 = {@code /datasets/{id}/search} 请求体 {@code use_kg:true}（检索期）。
 *       需要 {@code graphrag} 能力 + 数量上限（{@code mis.kb.engine.graph-max-libraries} 默认 2）。</li>
 *   <li>{@code kgBuildStatus}（默认 {@code none}）：四态 {@code none|building|ready|failed}。
 *       <b>落库（MIS 唯一事实源）+ 查询时引擎刷新回写</b>（U3 裁定），
 *       {@code KbGraphService.refreshStatus} 映射引擎 progress 后写回。</li>
 *   <li>{@code kgBuildMessage}（默认 {@code null}，≤200）：失败/构建中原因摘要；
 *       {@code ready} 时清空（状态机共享知识 §10-10）。</li>
 * </ul>
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
 * @param ocrEnabled             OCR 开关；能力 {@code parser_ocr=true} 前**不下发**；企业级增强一期新增
 * @param ocrLanguage            OCR 语言码值 zh/en/zh_en；能力支持前**不下发**；企业级增强一期新增
 * @param chunkOverlapTokenNum   分块重叠 token 数（正整数，null=引擎默认/0）；能力 {@code parser_overlap=true} 前**不下发**；企业级增强一期新增
 * @param useKnowledgeGraph      知识图谱开关；能力 {@code graphrag=true} 前**不下发**；Wave B GraphRAG PoC 新增
 * @param kgBuildStatus          图谱构建状态 none|building|ready|failed；落库 + 引擎刷新回写；Wave B GraphRAG PoC 新增
 * @param kgBuildMessage         图谱构建消息摘要（≤200，ready 时清空）；Wave B GraphRAG PoC 新增
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
        String rerankModelId,
        Boolean ocrEnabled,
        String ocrLanguage,
        Integer chunkOverlapTokenNum,
        Boolean useKnowledgeGraph,
        String kgBuildStatus,
        String kgBuildMessage) {

    /**
     * 兼容构造：11 参数旧签名，OCR/overlap 三字段与图谱三字段置 {@code null}（未设置）。
     *
     * <p>record 是位置参数，新增字段后既有 11 参构造点（测试夹具、门面组装等）
     * 无法再用旧签名；本构造器保持旧调用点零改动，同时保证「未设置」语义
     * 由 {@link #withDefaults()} 兜底（ocrEnabled→false、ocrLanguage→zh、
     * useKnowledgeGraph→false、kgBuildStatus→none）。
     */
    public RagSettings(
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
        this(topK, scoreThreshold, rerank, embeddingModel, retrievalMethod, chunkMethod,
                chunkTokenNum, separator, emptyResultStrategy, vectorSimilarityWeight,
                rerankModelId, null, null, null, null, null, null);
    }

    /**
     * 兼容构造：14 参数旧签名（企业级增强一期 canonical），图谱三字段置 {@code null}。
     *
     * <p>保持既有 14 参全量构造点（存量代码、测试）零改动；图谱三字段「未设置」语义
     * 由 {@link #withDefaults()} 兜底。注意：需要<b>透传</b>图谱字段的代码
     * （如 {@code RagSettingsService.enforceRerankAvailability}、
     * {@code RetrieveQueryResolver.applyOverride}）请用 17 参 canonical，
     * 不要走本构造（会把图谱字段静默置 null）。
     */
    public RagSettings(
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
        this(topK, scoreThreshold, rerank, embeddingModel, retrievalMethod, chunkMethod,
                chunkTokenNum, separator, emptyResultStrategy, vectorSimilarityWeight,
                rerankModelId, ocrEnabled, ocrLanguage, chunkOverlapTokenNum, null, null, null);
    }

    /** 默认召回条数。 */
    public static final int DEFAULT_TOP_K = 5;
    /** 默认相似度阈值。 */
    public static final double DEFAULT_SCORE_THRESHOLD = 0.2D;
    /** 默认检索方式。 */
    public static final String DEFAULT_RETRIEVAL_METHOD = "hybrid";
    /** 默认分块方法。 */
    public static final String DEFAULT_CHUNK_METHOD = "naive";
    /**
     * 默认分块 token 数。
     *
     * <p>2026-08-11 盘点后由 128 调整为 4096：默认 128（约 60~85 中文字/片）对中文业务知识库
     * 过小，切片过碎导致上下文割裂；集成库「百货收银」已手动调至系统上限 4096，故默认值对齐现状。
     * 仅影响未显式设置 chunkTokenNum 的库（withDefaults() 仅在 null 时兜底），存量显式值不受影响。
     */
    public static final int DEFAULT_CHUNK_TOKEN_NUM = 4096;
    /** 默认向量相似度权重（WA-01；hybrid 下语义 30% / 关键字 70%）。 */
    public static final double DEFAULT_VECTOR_SIMILARITY_WEIGHT = 0.3D;

    /** 默认 OCR 语言码值（企业级增强一期 KE-06；能力 {@code parser_ocr=true} 前不下发）。 */
    public static final String DEFAULT_OCR_LANGUAGE = "zh";
    /** OCR 语言码值：中文。 */
    public static final String OCR_LANGUAGE_ZH = "zh";
    /** OCR 语言码值：英文。 */
    public static final String OCR_LANGUAGE_EN = "en";
    /** OCR 语言码值：中英混合。 */
    public static final String OCR_LANGUAGE_ZH_EN = "zh_en";

    /** 检索方式码值：纯向量（语义）检索。 */
    public static final String METHOD_VECTOR = "vector";
    /** 检索方式码值：纯关键字检索。 */
    public static final String METHOD_KEYWORD = "keyword";
    /** 检索方式码值：混合检索（关键字 + 语义）。 */
    public static final String METHOD_HYBRID = "hybrid";

    /** 图谱构建状态码值：未构建（默认；可触发构建）。 */
    public static final String KG_STATUS_NONE = "none";
    /** 图谱构建状态码值：构建中（拒绝重复触发）。 */
    public static final String KG_STATUS_BUILDING = "building";
    /** 图谱构建状态码值：已就绪（kgBuildMessage 清空）。 */
    public static final String KG_STATUS_READY = "ready";
    /** 图谱构建状态码值：构建失败（可重试）。 */
    public static final String KG_STATUS_FAILED = "failed";

    /**
     * 全局默认设置（无库级配置、或多库检索回落时使用）。
     *
     * <p>OCR 三字段默认：{@code ocrEnabled=false}、{@code ocrLanguage="zh"}、
     * {@code chunkOverlapTokenNum=null}（null = 引擎默认/0，能力不支持时不下发）。
     *
     * <p>图谱三字段默认：{@code useKnowledgeGraph=false}、{@code kgBuildStatus="none"}、
     * {@code kgBuildMessage=null}。
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
                null,
                Boolean.FALSE,
                DEFAULT_OCR_LANGUAGE,
                null,
                Boolean.FALSE,
                KG_STATUS_NONE,
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
     * <p>{@code ocrEnabled} null → {@code false}；{@code ocrLanguage} 空 → {@code zh}；
     * {@code chunkOverlapTokenNum} 保持 {@code null}（null = 引擎默认/0，不硬编码兜底）。
     *
     * <p>{@code useKnowledgeGraph} null → {@code false}；{@code kgBuildStatus} 空/非法 →
     * {@value #KG_STATUS_NONE}（四态白名单由 {@link #normalizeKgBuildStatus} 归一）；
     * {@code kgBuildMessage} 保持 {@code null}（null = 无消息，由回写方写入）。
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
                rerankModelId,
                ocrEnabled != null ? ocrEnabled : Boolean.FALSE,
                ocrLanguage != null && !ocrLanguage.isBlank() ? ocrLanguage : DEFAULT_OCR_LANGUAGE,
                chunkOverlapTokenNum,
                useKnowledgeGraph != null ? useKnowledgeGraph : Boolean.FALSE,
                normalizeKgBuildStatus(kgBuildStatus),
                kgBuildMessage);
    }

    /**
     * 仅覆写图谱开关，其余字段原样透传（Wave B GraphRAG PoC，T03）。
     *
     * <p>命中测试「临时开启/关闭图谱增强」用（{@code HitTestRequest.enableGraph}）：
     * 只影响本次检索的内存值，<b>绝不落库</b>。图谱状态（kgBuildStatus/kgBuildMessage）
     * 保持原值——降级判定由 {@link RetrieveQueryResolver} S4.5 从库设置读取。
     *
     * @param useKnowledgeGraph 本次生效的图谱开关
     * @return 覆写后的新实例（本记录不可变，原实例不受影响）
     */
    public RagSettings withGraphOverride(boolean useKnowledgeGraph) {
        return new RagSettings(
                topK, scoreThreshold, rerank, embeddingModel, retrievalMethod,
                chunkMethod, chunkTokenNum, separator, emptyResultStrategy,
                vectorSimilarityWeight, rerankModelId,
                ocrEnabled, ocrLanguage, chunkOverlapTokenNum,
                useKnowledgeGraph, kgBuildStatus, kgBuildMessage);
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
     * 归一化 OCR 语言码值（静态工具，供校验层与合并器共用）。
     *
     * <p>产品三档固化 {@code zh}/{@code en}/{@code zh_en}；非法/空值回落
     * {@value #DEFAULT_OCR_LANGUAGE}。存库原样，能力不支持时不参与下发。
     *
     * @param language 原始码值，可为 {@code null}
     * @return 合法码值之一；非法/空值回落 {@value #DEFAULT_OCR_LANGUAGE}
     */
    public static String normalizeOcrLanguage(String language) {
        if (language == null || language.isBlank()) {
            return DEFAULT_OCR_LANGUAGE;
        }
        String lower = language.trim().toLowerCase();
        if (OCR_LANGUAGE_ZH.equals(lower) || OCR_LANGUAGE_EN.equals(lower)
                || OCR_LANGUAGE_ZH_EN.equals(lower)) {
            return lower;
        }
        return DEFAULT_OCR_LANGUAGE;
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

    /**
     * 归一化图谱构建状态码值（静态工具，供校验层与合并器共用）。
     *
     * <p>四态白名单 {@code none}/{@code building}/{@code ready}/{@code failed}；
     * 非法/空值一律回落 {@value #KG_STATUS_NONE}（防脏写，设计 §2.1 校验）。
     *
     * @param status 原始码值，可为 {@code null}
     * @return 合法码值之一；非法/空值一律回落 {@value #KG_STATUS_NONE}
     */
    public static String normalizeKgBuildStatus(String status) {
        if (status == null || status.isBlank()) {
            return KG_STATUS_NONE;
        }
        String lower = status.trim().toLowerCase();
        if (KG_STATUS_NONE.equals(lower) || KG_STATUS_BUILDING.equals(lower)
                || KG_STATUS_READY.equals(lower) || KG_STATUS_FAILED.equals(lower)) {
            return lower;
        }
        return KG_STATUS_NONE;
    }
}
