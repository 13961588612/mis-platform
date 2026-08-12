package com.mis.kb.domain.model;

import com.mis.kb.domain.service.SynonymExpandService;
import com.mis.kb.engine.RagflowProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * RetrieveQueryResolver S4.5 图谱增强降级测试（Wave B GraphRAG PoC，T04）。
 *
 * <p><b>Resolver 铁律（共享知识 §10-9）：</b>图谱降级只允许发生在合并器 S4.5，
 * 服务层禁止内联判断。本测试锁定三道防线的行为：
 * <ol>
 *   <li>能力：{@code useKnowledgeGraph=true} 但 {@code capabilities.graphSupported=false}
 *       → 降级 false + reason「当前引擎不支持知识图谱增强」；</li>
 *   <li>单库：多库检索遇 {@code useKnowledgeGraph=true} → 降级 false +
 *       reason「图谱增强仅支持单库检索，已回落混合检索」；</li>
 *   <li>状态：{@code kgBuildStatus != ready}（U5 强校验）→ 降级 false +
 *       reason「图谱未构建完成（当前状态：...），已回落混合检索」。</li>
 * </ol>
 * 全部通过后（能力 + 单库 + ready）→ {@code query.effectiveUseKnowledgeGraph()==true}，
 * 适配器据此分流 {@code /datasets/{id}/search}。
 */
class RetrieveQueryGraphDegradeTest {

    /** 全能力 + 图谱能力引擎（8 参 of()：rerank/metaFilter/replace/hybrid/delete + ocr/overlap/graph）。 */
    private static final EngineCapabilities GRAPH_CAPS =
            EngineCapabilities.of(true, true, true, true, true, false, false, true);
    /** 无图谱能力引擎（5 参 of()，graph 默认 false）。 */
    private static final EngineCapabilities NO_GRAPH_CAPS =
            EngineCapabilities.of(true, true, true, true, true);

    private RagflowProperties props;
    private RecordingExpandService expandService;

    @BeforeEach
    void setUp() {
        props = new RagflowProperties();
        props.setRerankModelId("BAAI/bge-reranker-v2-m3");
        expandService = new RecordingExpandService();
    }

    private RetrieveQueryResolver resolver() {
        return new RetrieveQueryResolver(props, expandService, null);
    }

    /** 构造带图谱字段的库级设置（其余检索字段走默认）。 */
    private static RagSettings graphSettings(boolean useKg, String kgStatus) {
        RagSettings base = RagSettings.defaults();
        return new RagSettings(
                base.topK(), base.scoreThreshold(), base.rerank(), base.embeddingModel(),
                base.retrievalMethod(), base.chunkMethod(), base.chunkTokenNum(), base.separator(),
                base.emptyResultStrategy(), base.vectorSimilarityWeight(), base.rerankModelId(),
                base.ocrEnabled(), base.ocrLanguage(), base.chunkOverlapTokenNum(),
                useKg, kgStatus, null);
    }

    private static RetrieveQueryResolver.RetrieveContext context(
            EngineCapabilities caps, List<Long> ids, RagSettings settings) {
        return new RetrieveQueryResolver.RetrieveContext(
                "五险一金怎么交",
                ids,
                settings == null ? Map.of() : Map.of(ids.get(0), settings),
                RetrieveQueryResolver.ParamOverride.none(),
                caps,
                SynonymMode.AUTO);
    }

    // ------------------------------------------------------------ 三道防线

    @Test
    @DisplayName("能力 false：useKnowledgeGraph=true → 降级 false + reason「当前引擎不支持知识图谱增强」")
    void degradeWhenCapabilityMissing() {
        RagSettings settings = graphSettings(true, RagSettings.KG_STATUS_READY);
        RetrieveQueryResolver.Resolution res = resolver().resolveAll(
                context(NO_GRAPH_CAPS, List.of(1L), settings));

        assertFalse(res.query().effectiveUseKnowledgeGraph());
        assertFalse(res.effectiveParams().useKnowledgeGraph());
        assertTrue(res.effectiveParams().degraded());
        assertTrue(res.effectiveParams().degradedReasons().stream()
                        .anyMatch(r -> r.contains("当前引擎不支持知识图谱增强")),
                "缺能力必须给出可读原因，实际=" + res.effectiveParams().degradedReasons());
    }

    @Test
    @DisplayName("多库：useKnowledgeGraph=true + 2 库 → 降级 false + reason「图谱增强仅支持单库检索」")
    void degradeWhenMultiLibrary() {
        RagSettings settings = graphSettings(true, RagSettings.KG_STATUS_READY);
        RetrieveQueryResolver.Resolution res = resolver().resolveAll(
                context(GRAPH_CAPS, List.of(1L, 2L), settings));

        assertFalse(res.query().effectiveUseKnowledgeGraph());
        assertFalse(res.effectiveParams().useKnowledgeGraph());
        assertTrue(res.effectiveParams().degradedReasons().stream()
                        .anyMatch(r -> r.contains("图谱增强仅支持单库检索")),
                "多库必须降级并给出原因，实际=" + res.effectiveParams().degradedReasons());
    }

    @Test
    @DisplayName("图未就绪（building）：useKnowledgeGraph=true → 降级 false + reason「图谱未构建完成」")
    void degradeWhenGraphNotReady() {
        RagSettings settings = graphSettings(true, RagSettings.KG_STATUS_BUILDING);
        RetrieveQueryResolver.Resolution res = resolver().resolveAll(
                context(GRAPH_CAPS, List.of(1L), settings));

        assertFalse(res.query().effectiveUseKnowledgeGraph());
        assertTrue(res.effectiveParams().degradedReasons().stream()
                        .anyMatch(r -> r.contains("图谱未构建完成") && r.contains("building")),
                "未就绪必须降级并回显当前状态，实际=" + res.effectiveParams().degradedReasons());
    }

    @Test
    @DisplayName("图未构建（none）与构建失败（failed）同样降级——U5 强校验 kgBuildStatus==ready")
    void degradeWhenGraphNoneOrFailed() {
        for (String status : List.of(RagSettings.KG_STATUS_NONE, RagSettings.KG_STATUS_FAILED)) {
            RagSettings settings = graphSettings(true, status);
            RetrieveQueryResolver.Resolution res = resolver().resolveAll(
                    context(GRAPH_CAPS, List.of(1L), settings));
            assertFalse(res.query().effectiveUseKnowledgeGraph(),
                    "kgBuildStatus=" + status + " 时图谱增强必须降级");
            assertTrue(res.effectiveParams().degradedReasons().stream()
                            .anyMatch(r -> r.contains("图谱未构建完成")),
                    "kgBuildStatus=" + status + " 必须给出原因，实际="
                            + res.effectiveParams().degradedReasons());
        }
    }

    // ------------------------------------------------------------ 放行路径

    @Test
    @DisplayName("全部通过（能力 + 单库 + ready）→ effectiveUseKnowledgeGraph()==true 且无图谱降级原因")
    void passThroughWhenAllGatesGreen() {
        RagSettings settings = graphSettings(true, RagSettings.KG_STATUS_READY);
        RetrieveQueryResolver.Resolution res = resolver().resolveAll(
                context(GRAPH_CAPS, List.of(1L), settings));

        assertTrue(res.query().effectiveUseKnowledgeGraph());
        assertTrue(res.effectiveParams().useKnowledgeGraph());
        assertFalse(res.effectiveParams().degradedReasons().stream()
                        .anyMatch(r -> r.contains("图谱")),
                "放行路径不应出现图谱降级原因，实际=" + res.effectiveParams().degradedReasons());
    }

    @Test
    @DisplayName("开关关（useKnowledgeGraph=false）→ 零图谱干预，与 Wave A 行为一致")
    void graphOffIsNoOp() {
        RagSettings settings = graphSettings(false, RagSettings.KG_STATUS_NONE);
        RetrieveQueryResolver.Resolution res = resolver().resolveAll(
                context(GRAPH_CAPS, List.of(1L), settings));

        assertFalse(res.query().effectiveUseKnowledgeGraph());
        assertFalse(res.effectiveParams().useKnowledgeGraph());
        assertFalse(res.effectiveParams().degradedReasons().stream()
                        .anyMatch(r -> r.contains("图谱")),
                "开关关时不应产生任何图谱降级原因，实际=" + res.effectiveParams().degradedReasons());
    }

    @Test
    @DisplayName("命中测试 override：enableGraph=true 经 KbHitTestService.withGraphOverride 后参与 S4.5 判定")
    void hitTestOverrideDrivesS45() {
        // 库设置开关 false，但命中测试 override 为 true（KbHitTestService 应用 withGraphOverride）
        RagSettings stored = graphSettings(false, RagSettings.KG_STATUS_READY);
        RagSettings overridden = stored.withGraphOverride(true);
        RetrieveQueryResolver.Resolution res = resolver().resolveAll(
                context(GRAPH_CAPS, List.of(1L), overridden));

        assertTrue(res.query().effectiveUseKnowledgeGraph(),
                "override=true 且能力/单库/ready 全通过 → 图谱增强必须生效");
    }

    // ---------------------------------------------------------------- 替身

    /** 同义词扩展记录型替身：S6 只做直通，不改变问句。 */
    private static final class RecordingExpandService extends SynonymExpandService {
        private final List<String> calls = new ArrayList<>();

        RecordingExpandService() {
            super(null, null);
        }

        @Override
        public SynonymExpansion expand(String question, boolean disabledForThisRun) {
            calls.add("expand(" + question + "," + disabledForThisRun + ")");
            return SynonymExpansion.noMatch(question, SynonymBudget.defaults(), List.of(), false);
        }

        @Override
        public SynonymExpansion expandFresh(String question, boolean disabledForThisRun) {
            calls.add("expandFresh(" + question + "," + disabledForThisRun + ")");
            return SynonymExpansion.noMatch(question, SynonymBudget.defaults(), List.of(), false);
        }
    }
}
