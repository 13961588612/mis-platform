package com.mis.kb.domain.model;

import com.mis.kb.domain.service.EngineModelPoolService;
import com.mis.kb.domain.service.SynonymExpandService;
import com.mis.kb.engine.RagflowProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 检索参数合并器（Wave A 核心组件，WA-02 / WA-07 / WA-11）。
 *
 * <p><b>存在理由：</b>二期之前，库级 RAG 设置存在 {@code kb_library.rag_settings_json} 里，
 * 但检索链路（{@code KbRetrieveService}）压根不读它——直接拿请求里的 topK/threshold
 * 就调引擎去了。结果是管理员在 L-08 面板上把检索方式改成 keyword、把权重拖到 0.6，
 * 实际检索行为纹丝不动。这是本波次要修的头号断点（D1）。
 *
 * <p><b>唯一收口铁律（设计文档 §7.2）：</b>任何需要「决定这次检索用什么参数」的代码，
 * 必须调用本类，禁止在服务层内联判断。目前的调用方只有两处：
 * {@code KbRetrieveService}（问答检索）与 {@code KbHitTestService}（命中测试）。
 *
 * <p><b>合并算法（S1→S6，与 §7.2 / §7.4 逐字对应）：</b>
 * <pre>
 * S1 选基准： 单库 → 该库设置(LIBRARY)；多库 → 全局默认(GLOBAL_DEFAULT)；空 → 全局默认
 * S2 覆盖：   requestOverride 逐字段非 null 才覆盖，命中即 source=REQUEST_OVERRIDE
 * S3 归一化： method 小写非法回落 hybrid；vector→weight 1.0；keyword→weight 0.0；hybrid→取设定值
 * S4 能力降级：hybrid 且引擎不支持 → vector；rerank 且引擎不支持或无全局模型 → false（各记一条原因）
 * S5 兜底：   topK clamp[1,100]；threshold clamp[0,1]；emptyResultStrategy 归一化
 * S6 同义词： 按 synonymMode 调 SynonymExpandService，用 expandedQuery 构造 RetrieveQuery（Wave D）
 * </pre>
 *
 * <p><b>Wave D 为什么把 S6 放在这里，而不是各服务自己调（WD-05）：</b>
 * 若让 {@code KbRetrieveService} 与 {@code KbHitTestService} 各自调一次扩展，
 * 两条链路迟早会漂移 —— 一边改了模式判定、另一边忘了同步，就会出现「命中测试里能扩展、
 * 真问答不扩展」。而命中测试的<b>全部价值</b>就在于「测的即是跑的」。收进合并器后，
 * 「扩展与否」和「用什么参数」由同一个入口、同一次调用决定，结构上杜绝漂移。
 *
 * <p><b>⛔ WD-06 红线：</b>{@link Resolution#expansion()} 只允许被<b>命中测试</b>读取。
 * 问答链路（{@code KbRetrieveService}）只能用 {@code query()}，
 * 绝不可把扩展轨迹塞进 {@code RetrieveHitsVO} —— 那等于把扩展串暴露给 mis-rag，AC-03b 判死。
 *
 * <p><b>为什么多库回落全局默认</b>（决策⑥）：三个库各配一套参数，一次跨库检索该听谁的？
 * 取任一库都是武断，做加权平均更荒谬（检索方式没法平均）。回落全局默认至少是
 * 可解释、可预期的，且 {@code EffectiveRetrieveParams.source} 会如实标注来源，
 * 管理员在命中测试页一眼能看出「这次用的不是你那个库的设置」。
 */
@Component
public class RetrieveQueryResolver {

    private static final Logger log = LoggerFactory.getLogger(RetrieveQueryResolver.class);

    /** topK 允许区间下界。 */
    public static final int MIN_TOP_K = 1;
    /** topK 允许区间上界。 */
    public static final int MAX_TOP_K = 100;

    private final RagflowProperties engineProperties;
    private final SynonymExpandService synonymExpandService;
    private final EngineModelPoolService modelPoolService;

    /**
     * 构造。
     *
     * @param engineProperties     引擎配置（提供全局重排模型 id）
     * @param synonymExpandService 同义词扩展服务（S6），<b>必填</b>。
     *                             刻意不做 null 兜底：装配缺失时就该在第一次检索时以 NPE 炸出来。
     *                             若在这里静默回落成「同义词已全局关闭」，管理员会去翻一个
     *                             根本没关的开关，排障成本远高于一个堆栈
     * @param modelPoolService     模型池服务（T03，kb_settings_model_chunk）。
     *                             S4 阶段用 {@code peekPool()}（只读缓存，绝不触发网络）校验
     *                             「库级重排模型是否在池内」；热路径零网络铁律见设计 §8-8
     */
    public RetrieveQueryResolver(
            RagflowProperties engineProperties,
            SynonymExpandService synonymExpandService,
            EngineModelPoolService modelPoolService) {
        this.engineProperties = engineProperties;
        this.synonymExpandService = synonymExpandService;
        this.modelPoolService = modelPoolService;
    }

    // ---------------------------------------------------------------- 入参类型

    /**
     * 单次请求的显式参数覆盖（仅命中测试调参使用；问答链路除 topK/threshold 外全为 null）。
     *
     * <p>逐字段语义：{@code null} 表示「不覆盖，沿用基准」，非 null 才生效。
     * 这里刻意<b>不</b>用「0 / 空串表示不覆盖」，否则用户没法把阈值显式设成 0。
     *
     * @param topK                   覆盖召回条数
     * @param threshold              覆盖相似度阈值
     * @param retrievalMethod        覆盖检索方式
     * @param vectorSimilarityWeight 覆盖向量相似度权重
     * @param rerank                 覆盖重排开关
     */
    public record ParamOverride(
            Integer topK,
            Double threshold,
            String retrievalMethod,
            Double vectorSimilarityWeight,
            Boolean rerank) {

        /** 全字段为空的覆盖（等价于「不覆盖」）。 */
        public static ParamOverride none() {
            return new ParamOverride(null, null, null, null, null);
        }

        /**
         * 是否没有任何有效覆盖项。
         *
         * @return 全字段为 null（{@code retrievalMethod} 空白也算无）返回 {@code true}
         */
        public boolean isEmpty() {
            return topK == null
                    && threshold == null
                    && (retrievalMethod == null || retrievalMethod.isBlank())
                    && vectorSimilarityWeight == null
                    && rerank == null;
        }
    }

    /**
     * 合并上下文。
     *
     * <p><b>Wave D 新增末位字段 {@code synonymMode}</b>（设计 §8.1-5.3 铁律：record 是位置参数，
     * 新字段一律追加末位，绝不插在中间 —— 插中间会让所有既有构造点<b>静默错位</b>，
     * 编译器不会报错，因为类型恰好能对上）。
     *
     * <p><b>企业级增强一期（KE-08/KE-09）新增末位 {@code documentIds} / {@code filterRequested}：</b>
     * 服务层把前端「按文档 + 上传时间范围」的原始过滤意图解析成具体的 MIS 文档 id 集后放入
     * {@code documentIds}（空 = 无过滤，R5 语义）；{@code filterRequested} 标记<b>原始意图</b>——
     * 即便解析后为空集（如全部文档已停用），仍据此判断是否要对「引擎不支持过滤」做降级提示。
     *
     * @param question           问题文本（<b>用户原话</b>；扩展在 S6 内部完成，调用方不必预处理）
     * @param scopedLibraryIds   已经过 ACL 过滤的库 ID 列表（合并器不做任何权限判断）
     * @param perLibrarySettings 库 ID → 库级设置；缺失的库按全局默认处理
     * @param requestOverride    显式覆盖；可为 {@code null}
     * @param capabilities       引擎能力；{@code null} 视为全不支持（保守降级）
     * @param synonymMode        同义词请求模式；{@code null} 收敛为 {@link SynonymMode#AUTO}
     *                           （老调用方语义不变：走热路径、不做版本校验）
     * @param documentIds        文档过滤：MIS 文档 id 集（服务层已解析）；空 = 不过滤
     * @param filterRequested    是否请求了文档/时间过滤（原始意图，供能力降级提示用）
     */
    public record RetrieveContext(
            String question,
            List<Long> scopedLibraryIds,
            Map<Long, RagSettings> perLibrarySettings,
            ParamOverride requestOverride,
            EngineCapabilities capabilities,
            SynonymMode synonymMode,
            List<Long> documentIds,
            boolean filterRequested) {

        /**
         * 兼容构造：6 参数旧签名，文档过滤两字段取「不过滤」语义。
         *
         * <p>record 是位置参数，新增字段后既有 6 参构造点（老调用方、单测夹具）保持零改动。
         */
        public RetrieveContext(
                String question,
                List<Long> scopedLibraryIds,
                Map<Long, RagSettings> perLibrarySettings,
                ParamOverride requestOverride,
                EngineCapabilities capabilities,
                SynonymMode synonymMode) {
            this(question, scopedLibraryIds, perLibrarySettings, requestOverride,
                    capabilities, synonymMode, List.of(), false);
        }

        /** 紧凑构造：把 null 集合统一收敛成空集合，省掉下游满地判空。 */
        public RetrieveContext {
            scopedLibraryIds = scopedLibraryIds == null ? List.of() : List.copyOf(scopedLibraryIds);
            perLibrarySettings = perLibrarySettings == null ? Map.of() : Map.copyOf(perLibrarySettings);
            requestOverride = requestOverride == null ? ParamOverride.none() : requestOverride;
            capabilities = capabilities == null ? EngineCapabilities.unsupported() : capabilities;
            synonymMode = synonymMode == null ? SynonymMode.AUTO : synonymMode;
            documentIds = documentIds == null ? List.of() : List.copyOf(documentIds);
        }
    }

    /**
     * 合并结果：发引擎的入参 + 给人看的解释，一次算出两份，避免重复计算导致口径漂移。
     *
     * <p><b>Wave D 新增末位字段 {@code expansion}</b>。
     *
     * <p><b>⛔ WD-06 红线：</b>{@code expansion} <b>只允许命中测试链路读取</b>。
     * 问答链路必须止步于 {@code query()} 与 {@code effectiveParams()} —— 一旦有人
     * 「顺手」把它塞进 {@code RetrieveHitsVO}，扩展串就流到了 mis-rag，AC-03b 直接判死。
     * {@code RetrieveHitsVoContractTest} 会对 {@code RetrieveHitsVO} 的字段集合做恒等断言，
     * 任何新增字段都会当场红灯。
     *
     * @param query           发给 {@code KnowledgeEnginePort.retrieve} 的查询；
     *                        其 {@code question} <b>已是扩展后的串</b>
     * @param effectiveParams 生效参数快照（含降级原因）
     * @param expansion       同义词扩展轨迹，<b>恒非 {@code null}</b>（四态之一）
     */
    public record Resolution(
            RetrieveQuery query,
            EffectiveRetrieveParams effectiveParams,
            SynonymExpansion expansion) {
    }

    // ---------------------------------------------------------------- 公开 API

    /**
     * 一次性算出查询与生效参数快照。
     *
     * @param ctx 合并上下文
     * @return 查询 + 生效参数
     */
    public Resolution resolveAll(RetrieveContext ctx) {
        RetrieveContext context = ctx == null
                ? new RetrieveContext(null, null, null, null, null, null)
                : ctx;

        // S1 选基准
        String source = context.scopedLibraryIds().size() == 1
                ? EffectiveRetrieveParams.SOURCE_LIBRARY
                : EffectiveRetrieveParams.SOURCE_GLOBAL_DEFAULT;
        RagSettings base = pickBase(context.scopedLibraryIds(), context.perLibrarySettings());

        // S2 应用覆盖
        ParamOverride override = context.requestOverride();
        if (!override.isEmpty()) {
            base = applyOverride(base, override);
            source = EffectiveRetrieveParams.SOURCE_REQUEST_OVERRIDE;
        }

        // S3 归一化检索方式与权重
        List<String> degradedReasons = new ArrayList<>();
        String method = RagSettings.normalizeRetrievalMethod(base.retrievalMethod());
        double weight = resolveWeight(method, base.vectorSimilarityWeight());
        boolean rerank = Boolean.TRUE.equals(base.rerank());

        // S4 能力降级
        EngineCapabilities caps = context.capabilities();
        if (RagSettings.METHOD_HYBRID.equals(method) && !caps.hybridSupported()) {
            method = RagSettings.METHOD_VECTOR;
            weight = 1.0D;
            degradedReasons.add("当前引擎不支持混合检索（关键字 + 语义），已降级为向量检索");
        }
        if (rerank && !caps.rerankSupported()) {
            rerank = false;
            degradedReasons.add("当前引擎不支持重排，已自动关闭");
        }
        // T03（kb_settings_model_chunk）：重排模型合并链 = 库级 ?? 全局（设计 §4.2 / U3）。
        // 全局未配是闸门：库级 rerankModelId 仅在有全局模型时参与合并链（PRD R-P0-05）。
        String globalRerankModelId = engineProperties == null ? null : engineProperties.getRerankModelId();
        boolean globalConfigured = globalRerankModelId != null && !globalRerankModelId.isBlank();
        boolean librarySpecified = base.rerankModelId() != null && !base.rerankModelId().isBlank();
        String rerankModelId = (globalConfigured && librarySpecified)
                ? base.rerankModelId() : globalRerankModelId;
        if (rerank && !globalConfigured) {
            rerank = false;
            degradedReasons.add("平台未配置全局重排模型（mis.kb.engine.rerank-model-id 为空），重排已自动关闭");
        } else if (rerank && modelPoolService != null) {
            // peekPool()：只读缓存，绝不触发网络（热路径零网络铁律，设计 §8-8）。
            // 池可判定时校验「库级模型在池内」，不在 → 回退全局（T03 验收）。
            EngineModelPool pool = modelPoolService.peekPool();
            if (pool != null && pool.available() && !pool.rerankIds().isEmpty()) {
                if (librarySpecified && !pool.rerankIds().contains(base.rerankModelId())) {
                    if (pool.rerankIds().contains(globalRerankModelId)) {
                        rerankModelId = globalRerankModelId;
                        degradedReasons.add("库级重排模型不在当前模型池，已回退全局模型");
                    } else {
                        rerank = false;
                        degradedReasons.add("库级重排模型不在当前模型池且全局模型亦不在池，重排已自动关闭");
                    }
                } else if (!pool.rerankIds().contains(rerankModelId)) {
                    rerank = false;
                    degradedReasons.add("重排模型不在当前模型池，重排已自动关闭");
                }
            }
        }

        // S4.5（Wave B GraphRAG PoC，T03）：图谱增强三道降级（能力/单库/kgBuildStatus）。
        // 开关只在「库设置 + 命中测试 override」两级出现——applyOverride 已用 17 参
        // canonical 透传图谱字段，所以这里从合并后的 base 读取 useKnowledgeGraph 即可
        // （命中测试的 enableGraph override 在 KbHitTestService 完成，不在此 S2 覆盖）。
        // 降级只允许发生在这里（Resolver 铁律 §10-9），服务层禁止内联判断。
        // 检索期强校验 kgBuildStatus==ready（U5）：图未就绪时 use_kg 会被引擎静默忽略，
        // 不降级会污染金标对比（管理员看不出 hybrid+graph 实际没加图）。
        boolean useKnowledgeGraph = Boolean.TRUE.equals(base.useKnowledgeGraph());
        // 多库场景的图谱请求信号修正：S1 基准在多库时回落全局默认（useKnowledgeGraph=false），
        // 但图谱开关是「库级特性开关」——任一被检索库开启图谱，即视为本次检索<b>请求了</b>
        // 图谱增强。若不修正，管理员在单库开了图、跨库检索时会被静默忽略且无任何提示，
        // 违背「绝不静默忽略 + degradedReason 回显」原则；修正后由下方「仅支持单库」闸门
        // 显式降级并给出可读原因（测试：RetrieveQueryGraphDegradeTest.degradeWhenMultiLibrary）。
        if (!useKnowledgeGraph && context.scopedLibraryIds().size() > 1) {
            useKnowledgeGraph = context.perLibrarySettings().values().stream()
                    .anyMatch(s -> Boolean.TRUE.equals(s.useKnowledgeGraph()));
        }
        if (useKnowledgeGraph && !caps.graphSupported()) {
            useKnowledgeGraph = false;
            degradedReasons.add("当前引擎不支持知识图谱增强");
        }
        if (useKnowledgeGraph && context.scopedLibraryIds().size() > 1) {
            useKnowledgeGraph = false;
            degradedReasons.add("图谱增强仅支持单库检索，已回落混合检索");
        }
        if (useKnowledgeGraph && !RagSettings.KG_STATUS_READY.equals(base.kgBuildStatus())) {
            useKnowledgeGraph = false;
            degradedReasons.add("图谱未构建完成（当前状态："
                    + RagSettings.normalizeKgBuildStatus(base.kgBuildStatus())
                    + "），已回落混合检索");
        }

        // S5 兜底
        int topK = clampTopK(base.topK());
        double threshold = clampRatio(base.scoreThreshold(), RagSettings.DEFAULT_SCORE_THRESHOLD);
        String emptyStrategy = EmptyResultStrategy.normalize(base.emptyResultStrategy());
        String effectiveRerankModelId = rerank ? rerankModelId : null;

        // S4.5（KE-08/KE-09）：文档/时间范围过滤能力降级。
        // 未请求过滤（filterRequested=false）→ 一律不下发 document_ids（R5：空 = 全量），
        // 即使上下文带了残留 id 也不透传——「原始意图」与「解析结果」的硬边界：
        // 服务层只在有过滤意图时解析 id 集，resolver 只在有过滤意图时透传。
        // 请求了过滤但引擎不支持（metadataFilterSupported=false）→ 清空过滤集并记一条
        // 降级原因，绝不静默忽略（对齐 WA-06「前端置灰 + 后端强制 + 降级提示」三道防线）。
        List<Long> effectiveDocumentIds = List.of();
        if (context.filterRequested()) {
            effectiveDocumentIds = context.documentIds();
            if (!caps.metadataFilterSupported()) {
                effectiveDocumentIds = List.of();
                degradedReasons.add("当前引擎不支持文档/时间范围过滤，已忽略过滤条件");
            }
        }

        // S6 同义词扩展（Wave D）。必须在构造 RetrieveQuery 之前完成 ——
        // RetrieveQuery.question 的语义是「实际送引擎的串」，不是用户原话（§7.3）。
        SynonymExpansion expansion = expandSynonyms(context);

        RetrieveQuery query = new RetrieveQuery(
                expansion.expandedQuery(),
                context.scopedLibraryIds(),
                topK,
                threshold,
                method,
                weight,
                rerank,
                effectiveRerankModelId,
                emptyStrategy,
                effectiveDocumentIds,
                useKnowledgeGraph);

        EffectiveRetrieveParams effective = new EffectiveRetrieveParams(
                topK, threshold, method, weight, rerank, effectiveRerankModelId,
                emptyStrategy, source, degradedReasons, useKnowledgeGraph);

        log.debug("检索参数合并完成 libraryIds={} source={} method={} weight={} topK={} "
                        + "threshold={} rerank={} emptyStrategy={} degraded={} graph={} synonym={}/{}组",
                context.scopedLibraryIds(), source, method, weight, topK,
                threshold, rerank, emptyStrategy, degradedReasons,
                useKnowledgeGraph,
                expansion.status(), expansion.usedGroups());
        if (!degradedReasons.isEmpty()) {
            log.warn("检索参数发生降级 libraryIds={} reasons={}",
                    context.scopedLibraryIds(), degradedReasons);
        }
        return new Resolution(query, effective, expansion);
    }

    /**
     * 仅取发引擎的查询。
     *
     * @param ctx 合并上下文
     * @return 检索查询
     */
    public RetrieveQuery resolve(RetrieveContext ctx) {
        return resolveAll(ctx).query();
    }

    /**
     * 仅取生效参数快照。
     *
     * @param ctx 合并上下文
     * @return 生效参数
     */
    public EffectiveRetrieveParams effective(RetrieveContext ctx) {
        return resolveAll(ctx).effectiveParams();
    }

    /**
     * 无命中时对外回显的空结果策略（S1 口径的独立出口）。
     *
     * <p>{@code scoped} 为空时不该调引擎，但仍要告诉调用方「按什么策略兜底」。
     *
     * @param scopedLibraryIds   过滤后的库 ID
     * @param perLibrarySettings 库级设置
     * @return 策略码值，恒在 {@link EmptyResultStrategy} 三值域内
     */
    public String resolveEmptyResultStrategy(
            List<Long> scopedLibraryIds, Map<Long, RagSettings> perLibrarySettings) {
        RagSettings base = pickBase(
                scopedLibraryIds == null ? List.of() : scopedLibraryIds,
                perLibrarySettings == null ? Map.of() : perLibrarySettings);
        return EmptyResultStrategy.normalize(base.emptyResultStrategy());
    }

    // ---------------------------------------------------------------- 内部步骤

    /**
     * S1：选取参数基准。
     *
     * @param ids    过滤后的库 ID
     * @param perLib 库级设置映射
     * @return 单库时该库设置（已补默认），否则全局默认
     */
    private RagSettings pickBase(List<Long> ids, Map<Long, RagSettings> perLib) {
        if (ids.size() == 1) {
            RagSettings s = perLib.get(ids.get(0));
            return s == null ? RagSettings.defaults() : s.withDefaults();
        }
        return RagSettings.defaults();
    }

    /**
     * S2：逐字段应用显式覆盖。
     *
     * <p>只覆盖检索相关的 5 个字段；切片类字段（chunkMethod 等）属建库期参数，
     * 单次检索无从覆盖，原样保留。OCR/overlap 三字段（KE-06/KE-07）同样属建库期
     * parser_config 参数，单次检索不消费，但<b>原样透传</b>（record 位置参数，
     * 用 11 参旧构造会静默置 null，破坏设置完整性）。
     *
     * @param base 基准设置
     * @param ov   覆盖项
     * @return 覆盖后的新设置
     */
    private RagSettings applyOverride(RagSettings base, ParamOverride ov) {
        // 17 参 canonical 透传图谱三字段（useKnowledgeGraph/kgBuildStatus/kgBuildMessage）——
        // 绝不能走 14 参旧构造，否则图谱字段被静默置 null（record 末位追加铁律 §10-8）。
        // 注意图谱开关属「库设置 + 命中测试 override」两级，不在此 S2 覆盖——由 S4.5
        // 从库设置合并（{@code useKnowledgeGraph} 的 override 在 KbHitTestService 完成）。
        return new RagSettings(
                ov.topK() != null ? ov.topK() : base.topK(),
                ov.threshold() != null ? ov.threshold() : base.scoreThreshold(),
                ov.rerank() != null ? ov.rerank() : base.rerank(),
                base.embeddingModel(),
                ov.retrievalMethod() != null && !ov.retrievalMethod().isBlank()
                        ? ov.retrievalMethod() : base.retrievalMethod(),
                base.chunkMethod(),
                base.chunkTokenNum(),
                base.separator(),
                base.emptyResultStrategy(),
                ov.vectorSimilarityWeight() != null
                        ? ov.vectorSimilarityWeight() : base.vectorSimilarityWeight(),
                base.rerankModelId(),
                base.ocrEnabled(),
                base.ocrLanguage(),
                base.chunkOverlapTokenNum(),
                base.useKnowledgeGraph(),
                base.kgBuildStatus(),
                base.kgBuildMessage());
    }

    /**
     * S6：按请求模式执行同义词扩展（Wave D）。
     *
     * <p><b>三条路径的差别只有「要不要先校验词表版本」，扩展算法本身完全同一份</b>
     * （{@code SynonymExpandService} 是唯一收口，WD-05）：
     * <table border="1">
     *   <caption>模式与调用路径</caption>
     *   <tr><th>模式</th><th>调用</th><th>一致性层</th><th>典型调用方</th></tr>
     *   <tr><td>{@link SynonymMode#FRESH}</td><td>{@code expandFresh(q, false)}</td>
     *       <td>L3 强一致（同步比对版本号）</td><td>命中测试（Q7 的兑现点）</td></tr>
     *   <tr><td>{@link SynonymMode#OFF_THIS_RUN}</td><td>{@code expand(q, true)}</td>
     *       <td>不读词典</td><td>命中测试勾选「本次禁用同义词」</td></tr>
     *   <tr><td>{@link SynonymMode#AUTO}</td><td>{@code expand(q, false)}</td>
     *       <td>L2 最终一致（3s 轮询快照）</td><td>问答检索（热路径，禁查库）</td></tr>
     * </table>
     *
     * <p><b>为什么 {@code OFF_THIS_RUN} 走 {@code expand} 而不是 {@code expandFresh}：</b>
     * 本次既然不扩展，就没有任何理由为它做一次同步版本校验 —— 那是一次纯浪费的往返。
     * 且 {@code doExpand} 的开关判定在读词典<b>之前</b>短路，传进去的快照根本不会被解引用。
     *
     * <p><b>为什么 {@code AUTO} 不允许「顺手」升级成 {@code expandFresh}：</b>问答是热路径，
     * 每次问答都同步查一次 {@code kb_synonym_config} 会把词典这条本该零成本的旁路
     * 变成问答链路的新增数据库依赖 —— 库抖一下，问答就跟着抖。3 秒最终一致是
     * 主理人对 Q7 的明确裁决（「问答链路约 3 秒内全平台生效」），不是妥协。
     *
     * @param context 合并上下文（已保证 {@code synonymMode} 非 null）
     * @return 扩展结果，恒非 {@code null}（四态之一）
     */
    private SynonymExpansion expandSynonyms(RetrieveContext context) {
        SynonymMode mode = context.synonymMode();
        String question = context.question();
        if (mode == SynonymMode.FRESH) {
            return synonymExpandService.expandFresh(question, false);
        }
        return synonymExpandService.expand(question, mode == SynonymMode.OFF_THIS_RUN);
    }

    /**
     * S3：按检索方式决定权重。
     *
     * <p>这是「非 hybrid 强制覆写」<b>唯一</b>被允许发生的地方（主理人约束②）——
     * 它只作用于本次检索的内存值，绝不回写库级设置，因此用户在 vector 与 hybrid
     * 之间来回切换时，之前设的 0.4 不会被吃掉。
     *
     * @param method 已归一化的检索方式
     * @param raw    库级/覆盖后的权重原值，可为 {@code null}
     * @return [0,1] 区间的生效权重
     */
    private double resolveWeight(String method, Double raw) {
        return switch (method) {
            case RagSettings.METHOD_VECTOR -> 1.0D;
            case RagSettings.METHOD_KEYWORD -> 0.0D;
            default -> clampRatio(raw, RagSettings.DEFAULT_VECTOR_SIMILARITY_WEIGHT);
        };
    }

    /** topK 兜底与钳制。 */
    private static int clampTopK(Integer topK) {
        if (topK == null) {
            return RagSettings.DEFAULT_TOP_K;
        }
        if (topK < MIN_TOP_K) {
            return MIN_TOP_K;
        }
        return Math.min(topK, MAX_TOP_K);
    }

    /** [0,1] 区间兜底与钳制。 */
    private static double clampRatio(Double value, double fallback) {
        if (value == null) {
            return fallback;
        }
        if (value < 0.0D) {
            return 0.0D;
        }
        return Math.min(value, 1.0D);
    }
}
