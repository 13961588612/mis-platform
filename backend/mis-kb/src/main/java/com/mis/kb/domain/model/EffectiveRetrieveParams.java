package com.mis.kb.domain.model;

import java.util.List;

/**
 * 本次检索实际生效的参数快照（WA-02 / WA-07 / WA-14）。
 *
 * <p>与 {@link RetrieveQuery} 的分工：{@code RetrieveQuery} 是<b>发给引擎的入参</b>，
 * 本记录是<b>给人看的解释</b>——回答「这次检索到底用了什么参数、从哪来的、降级了没有」。
 * 命中测试页与问答排障都靠它，缺了它调参就只能靠猜。
 *
 * <p>{@code degradedReasons} 每发生一次降级追加一条人类可读原因，前端直接展示；
 * 空列表表示全程无降级。
 *
 * @param topK                   生效召回条数
 * @param threshold              生效相似度阈值
 * @param retrievalMethod        生效检索方式（已归一化，且已过能力降级）
 * @param vectorSimilarityWeight 生效向量相似度权重（已按检索方式覆写）
 * @param rerank                 生效重排开关（已过能力与模型 ID 双重降级）
 * @param rerankModelId          实际下发的重排模型 ID；未启用重排时为 {@code null}
 * @param emptyResultStrategy    生效空结果策略码值
 * @param source                 参数基准来源，见 {@link #SOURCE_LIBRARY} 等常量
 * @param degradedReasons        降级原因列表，永不为 {@code null}
 * @param useKnowledgeGraph      图谱增强实际生效开关（Wave B GraphRAG PoC，T03，末位追加）。
 *                               {@code true} = 本次走了 {@code /datasets/{id}/search} + {@code use_kg:true}；
 *                               被 S4.5 降级时为 {@code false}（原因在 {@code degradedReasons}）。
 *                               命中测试页据此回显「本次实际生效：图谱增强 开/关（原因）」。
 * @param useRaptor              RAPTOR 摘要实际生效开关（Wave C RAPTOR，T03，末位追加）。
 *                               {@code true} = 本次请求了 RAPTOR 增强（引擎建树后
 *                               {@code /retrieval} 自动融合摘要，T00 P3a 实测——MIS 检索期
 *                               <b>不改请求体</b>，{@link RetrieveQuery} 零改动）；
 *                               被 S4.6 降级（能力不支持 / 未建树）时为 {@code false}
 *                               （原因在 {@code degradedReasons}）。
 *                               命中测试页据此回显「库已建树 / RAPTOR 未构建完成」。
 */
public record EffectiveRetrieveParams(
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

    /** 参数基准来源：单库检索，取该库的库级设置。 */
    public static final String SOURCE_LIBRARY = "LIBRARY";
    /** 参数基准来源：多库检索（或无库级设置），取全局默认。 */
    public static final String SOURCE_GLOBAL_DEFAULT = "GLOBAL_DEFAULT";
    /** 参数基准来源：调用方显式覆盖（命中测试调参）。 */
    public static final String SOURCE_REQUEST_OVERRIDE = "REQUEST_OVERRIDE";

    /**
     * 紧凑构造：保证 {@code degradedReasons} 永不为 null 且不可变；
     * {@code useKnowledgeGraph}/{@code useRaptor} 缺省按 {@code false} 收敛。
     *
     * <p>前端拿到 null 列表就得到处判空，不如在源头收敛。
     */
    public EffectiveRetrieveParams {
        degradedReasons = degradedReasons == null ? List.of() : List.copyOf(degradedReasons);
        useKnowledgeGraph = useKnowledgeGraph != null && useKnowledgeGraph;
        useRaptor = useRaptor != null && useRaptor;
    }

    /**
     * 本次检索是否发生过降级。
     *
     * @return 有任意降级原因返回 {@code true}
     */
    public boolean degraded() {
        return !degradedReasons.isEmpty();
    }
}
