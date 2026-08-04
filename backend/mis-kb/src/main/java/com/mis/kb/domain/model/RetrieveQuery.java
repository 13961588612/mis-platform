package com.mis.kb.domain.model;

import java.util.List;

/**
 * 检索查询（对外只认 MIS ID）。
 *
 * <p>{@code libraryIds} 为 MIS 知识库 id 列表；适配器内部负责翻译为引擎原生 dataset id。
 *
 * <p><b>Wave A（WA-02/WA-05/WA-11）扩展：</b>本记录不再只是「问题 + 范围 + topK/阈值」，
 * 而是一次检索的<b>完整生效参数包</b>——检索方式、权重、重排开关与模型 ID、空结果策略
 * 全部随查询下发。这些字段的取值<b>只能</b>由 {@link RetrieveQueryResolver} 计算产出，
 * 任何服务层禁止自行拼装（设计文档 §7.2 铁律）。
 *
 * <p>保留旧 4 参构造为兼容重载，使既有调用点（如 Mock/单测）无需同步改造。
 *
 * <h2>⚠ Wave D 铁律：{@code question} 的语义已被改写（设计文档 §7.1）</h2>
 *
 * <p><b>自 Wave D 起，{@code question} 承载的是「送给检索引擎的查询串」，
 * 它可能是同义词扩展后的结果，不再等同于「用户原话」。</b>
 *
 * <table border="1">
 *   <caption>question 的实际内容</caption>
 *   <tr><th>场景</th><th>{@code question} 的内容</th></tr>
 *   <tr><td>扩展未生效（开关关 / 无命中 / 超预算回退）</td><td>与用户原话相同</td></tr>
 *   <tr><td>扩展生效</td><td>原话 + 就地插入的扩展词，<b>与用户原话不同</b></td></tr>
 * </table>
 *
 * <p>配套三条推论，改这个文件的人必须同时遵守：
 * <ol>
 *   <li><b>不新增 {@code originalQuestion} 字段。</b>加字段看似安全，实则会让「到底该用哪个」
 *       这个问题在下游每个调用点重演一次，且旧代码默认读 {@code question} 时行为反而更不可预测。
 *       用户原话由<b>调用方自己持有</b>（{@code mis-rag} 的 {@code kb_client.py} 手上一直有），
 *       mis-kb 不负责回传。另外，record 是位置参数，加字段即破坏性变更。</li>
 *   <li><b>WD-06 红线</b>：扩展串<b>只允许流向检索引擎</b>。喂给 LLM 的提示词、写入
 *       {@code kb_qa_record} 的问题字段、前端回显的问题文本，<b>一律用原话</b>。
 *       这条由 {@code RetrieveHitsVoContractTest} 做断言型防守，不靠 code review 记住。</li>
 *   <li>扩展轨迹挂在 {@code RetrieveQueryResolver.Resolution.expansion()} 上，
 *       <b>只有命中测试链路读它</b>；正式检索链路只把它写进 DEBUG 日志，不进任何响应体。</li>
 * </ol>
 *
 * @param question               <b>送给引擎的查询串</b>（Wave D 起可能已扩展，见上方铁律）
 * @param libraryIds             MIS 知识库 id 列表
 * @param topK                   召回条数
 * @param threshold              相似度阈值
 * @param retrievalMethod        归一化后的检索方式 vector/keyword/hybrid
 * @param vectorSimilarityWeight 向量相似度权重 [0,1]，已按检索方式强制覆写
 * @param rerank                 是否启用重排（已过引擎能力与模型 ID 双重降级）
 * @param rerankModelId          全局重排模型 ID；{@code rerank=false} 时无意义
 * @param emptyResultStrategy    空结果策略码值（MIS 业务语义，不下发引擎）
 */
public record RetrieveQuery(
        String question,
        List<Long> libraryIds,
        Integer topK,
        Double threshold,
        String retrievalMethod,
        Double vectorSimilarityWeight,
        Boolean rerank,
        String rerankModelId,
        String emptyResultStrategy) {

    /** 默认召回条数。 */
    public static final int DEFAULT_TOP_K = 5;

    /**
     * 兼容构造：仅指定问题 / 范围 / topK / 阈值。
     *
     * <p>其余字段留空，由适配器按各自默认行为处理（RAGFlow 侧不下发对应键）。
     * <b>生产链路禁止使用本构造</b>——它绕过了参数合并器，会让库级设置再次失效
     * （正是 Wave A 要修的 D1 断点）。仅供测试与不关心检索方式的场景使用。
     *
     * @param question  问题文本
     * @param libraryIds MIS 知识库 id 列表
     * @param topK      召回条数
     * @param threshold 相似度阈值
     */
    public RetrieveQuery(String question, List<Long> libraryIds, Integer topK, Double threshold) {
        this(question, libraryIds, topK, threshold, null, null, null, null, null);
    }

    /**
     * 生效召回条数。
     *
     * @return topK 合法时取其值，否则 {@value #DEFAULT_TOP_K}
     */
    public int effectiveTopK() {
        return topK != null && topK > 0 ? topK : DEFAULT_TOP_K;
    }

    /**
     * 生效相似度阈值。
     *
     * @return threshold 非空时取其值，否则 0.0
     */
    public double effectiveThreshold() {
        return threshold != null ? threshold : 0.0d;
    }

    /**
     * 生效检索方式。
     *
     * @return 归一化码值；未指定时回落 {@link RagSettings#DEFAULT_RETRIEVAL_METHOD}
     */
    public String effectiveRetrievalMethod() {
        return RagSettings.normalizeRetrievalMethod(retrievalMethod);
    }

    /**
     * 生效向量相似度权重。
     *
     * <p>合并器已按 §7.2-S3 覆写；此处仅对「走兼容构造、未经合并器」的场景兜底：
     * vector→1.0、keyword→0.0、hybrid→默认 0.3。
     *
     * @return [0,1] 区间内的权重
     */
    public double effectiveVectorSimilarityWeight() {
        if (vectorSimilarityWeight != null) {
            return clamp(vectorSimilarityWeight);
        }
        return switch (effectiveRetrievalMethod()) {
            case RagSettings.METHOD_VECTOR -> 1.0D;
            case RagSettings.METHOD_KEYWORD -> 0.0D;
            default -> RagSettings.DEFAULT_VECTOR_SIMILARITY_WEIGHT;
        };
    }

    /**
     * 是否启用重排。
     *
     * @return 显式为 {@code true} 才启用；null 视为不启用
     */
    public boolean effectiveRerank() {
        return Boolean.TRUE.equals(rerank);
    }

    /**
     * 是否需要向引擎下发 {@code rerank_id}。
     *
     * <p>「开关为真」且「模型 ID 非空」两个条件同时满足才下发；否则连键都不放进请求体
     * （空串会被 RAGFlow 当成合法模型名，反而报错）。
     *
     * @return 需要下发返回 {@code true}
     */
    public boolean shouldSendRerankId() {
        return effectiveRerank() && rerankModelId != null && !rerankModelId.isBlank();
    }

    private static double clamp(double v) {
        if (v < 0.0D) {
            return 0.0D;
        }
        return Math.min(v, 1.0D);
    }
}
