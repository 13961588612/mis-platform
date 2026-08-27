package com.mis.kb.domain.model;

import com.mis.kb.domain.service.SynonymExpandService;
import com.mis.kb.engine.RagflowProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * RetrieveQueryResolver S4.6 RAPTOR 降级测试（Wave C RAPTOR，T04）。
 *
 * <p><b>Resolver 铁律（共享知识 §10-9）：</b>RAPTOR 降级只允许发生在合并器 S4.6，
 * 服务层禁止内联判断。本测试锁定两道降级：
 * <ol>
 *   <li>能力：{@code useRaptor=true} 但 {@code capabilities.raptorSupported=false}
 *       → 降级 false + reason「当前引擎不支持 RAPTOR 摘要增强」；</li>
 *   <li>状态：{@code raptorBuildStatus != ready} → 降级 false +
 *       reason「RAPTOR 未构建完成（当前状态：...）」；</li>
 *   <li>⚠ 检索期零回归（T00 P3a）：引擎建树后经典 /retrieval 自动融合摘要，
 *       RetrieveQuery 零改动——本测试断言 {@code query().useRaptor()} 恒 false
 *       （不参与检索请求体），只有 effectiveParams.useRaptor 回显。</li>
 * </ol>
 * 全部通过后（能力 + ready）→ {@code effectiveParams.useRaptor()==true}（回显）。
 */
class RetrieveQueryRaptorDegradeTest {

    /** 全能力 + RAPTOR 能力引擎（9 参 of()，raptor=true）。 */
    private static final EngineCapabilities RAPTOR_CAPS =
            EngineCapabilities.of(true, true, true, true, true, false, false, true, true);
    /** 无 RAPTOR 能力引擎（graph 支持、raptor 不支持）。 */
    private static final EngineCapabilities NO_RAPTOR_CAPS =
            EngineCapabilities.of(true, true, true, true, true, false, false, true, false);

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

    /** 构造带 RAPTOR 字段的库级设置（其余检索字段走默认）。 */
    private static RagSettings raptorSettings(boolean useRaptor, String raptorStatus) {
        RagSettings base = RagSettings.defaults();
        return new RagSettings(
                base.topK(), base.scoreThreshold(), base.rerank(), base.embeddingModel(),
                base.retrievalMethod(), base.chunkMethod(), base.chunkTokenNum(), base.separator(),
                base.emptyResultStrategy(), base.vectorSimilarityWeight(), base.rerankModelId(),
                base.ocrEnabled(), base.ocrLanguage(), base.chunkOverlapTokenNum(),
                base.useKnowledgeGraph(), base.kgBuildStatus(), base.kgBuildMessage(),
                useRaptor, base.raptorMaxTokenNum(), base.raptorThreshold(),
                base.raptorMaxCluster(), base.raptorPrompt(), raptorStatus, null,
                null, null);
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

    // ------------------------------------------------------------ 两道降级

    @Test
    @DisplayName("能力 false：useRaptor=true → 降级 false + reason「当前引擎不支持 RAPTOR 摘要增强」")
    void degradeWhenCapabilityMissing() {
        RagSettings settings = raptorSettings(true, RagSettings.RAPTOR_STATUS_READY);
        RetrieveQueryResolver.Resolution res = resolver().resolveAll(
                context(NO_RAPTOR_CAPS, List.of(1L), settings));

        assertFalse(res.effectiveParams().useRaptor());
        assertTrue(res.effectiveParams().degraded());
        assertTrue(res.effectiveParams().degradedReasons().stream()
                        .anyMatch(r -> r.contains("当前引擎不支持 RAPTOR 摘要增强")),
                "缺能力必须给出可读原因，实际=" + res.effectiveParams().degradedReasons());
    }

    @Test
    @DisplayName("未就绪（building）：useRaptor=true → 降级 false + reason「RAPTOR 未构建完成」")
    void degradeWhenRaptorNotReady() {
        RagSettings settings = raptorSettings(true, RagSettings.RAPTOR_STATUS_BUILDING);
        RetrieveQueryResolver.Resolution res = resolver().resolveAll(
                context(RAPTOR_CAPS, List.of(1L), settings));

        assertFalse(res.effectiveParams().useRaptor());
        assertTrue(res.effectiveParams().degradedReasons().stream()
                        .anyMatch(r -> r.contains("RAPTOR 未构建完成") && r.contains("building")),
                "未就绪必须降级并回显当前状态，实际=" + res.effectiveParams().degradedReasons());
    }

    @Test
    @DisplayName("未构建（none）与构建失败（failed）同样降级——强校验 raptorBuildStatus==ready")
    void degradeWhenRaptorNoneOrFailed() {
        for (String status : List.of(RagSettings.RAPTOR_STATUS_NONE, RagSettings.RAPTOR_STATUS_FAILED)) {
            RagSettings settings = raptorSettings(true, status);
            RetrieveQueryResolver.Resolution res = resolver().resolveAll(
                    context(RAPTOR_CAPS, List.of(1L), settings));
            assertFalse(res.effectiveParams().useRaptor(),
                    "raptorBuildStatus=" + status + " 时 RAPTOR 增强必须降级");
            assertTrue(res.effectiveParams().degradedReasons().stream()
                            .anyMatch(r -> r.contains("RAPTOR 未构建完成")),
                    "raptorBuildStatus=" + status + " 必须给出原因，实际="
                            + res.effectiveParams().degradedReasons());
        }
    }

    @Test
    @DisplayName("多库：任一被检索库开启 RAPTOR → 信号修正为请求增强；未就绪降级")
    void multiLibrarySignalCorrection() {
        RagSettings libA = raptorSettings(false, RagSettings.RAPTOR_STATUS_NONE);
        RagSettings libB = raptorSettings(true, RagSettings.RAPTOR_STATUS_READY);
        RetrieveQueryResolver.Resolution res = resolver().resolveAll(
                new RetrieveQueryResolver.RetrieveContext(
                        "q", List.of(1L, 2L),
                        Map.of(1L, libA, 2L, libB),
                        RetrieveQueryResolver.ParamOverride.none(),
                        RAPTOR_CAPS,
                        SynonymMode.AUTO));

        // 库 B 已开启且 ready → 本次检索请求了 RAPTOR 增强（回显 true）
        assertTrue(res.effectiveParams().useRaptor(),
                "多库时任一库开启 RAPTOR 即视为请求增强（与图谱同款信号修正）");
    }

    // ------------------------------------------------------------ 放行路径

    @Test
    @DisplayName("全部通过（能力 + ready）→ effectiveParams.useRaptor()==true 且无 RAPTOR 降级原因")
    void passThroughWhenAllGatesGreen() {
        RagSettings settings = raptorSettings(true, RagSettings.RAPTOR_STATUS_READY);
        RetrieveQueryResolver.Resolution res = resolver().resolveAll(
                context(RAPTOR_CAPS, List.of(1L), settings));

        assertTrue(res.effectiveParams().useRaptor());
        assertFalse(res.effectiveParams().degradedReasons().stream()
                        .anyMatch(r -> r.contains("RAPTOR")),
                "放行路径不应出现 RAPTOR 降级原因，实际=" + res.effectiveParams().degradedReasons());
    }

    @Test
    @DisplayName("⚠ 检索期零回归：RetrieveQuery 不带 RAPTOR 标记（引擎 /retrieval 自动融合）")
    void retrievalQueryUnchanged() {
        RagSettings settings = raptorSettings(true, RagSettings.RAPTOR_STATUS_READY);
        RetrieveQueryResolver.Resolution res = resolver().resolveAll(
                context(RAPTOR_CAPS, List.of(1L), settings));

        assertTrue(res.effectiveParams().useRaptor(),
                "回显层 useRaptor=true（MIS 侧语义）");
        // RetrieveQuery 不新增任何 RAPTOR 字段——引擎建树后经典检索自动融合摘要，
        // MIS 检索期零改动（T00 P3a 实测）。这里只做编译期断言：字段不存在即零回归。
        assertFalse(res.query().retrievalMethod().isBlank(), "query 结构保持 Wave A 原样");
    }

    @Test
    @DisplayName("命中测试 override：enableRaptor=true 经 KbHitTestService.withRaptorOverride 后参与 S4.6 判定")
    void hitTestOverrideDrivesS46() {
        // 库设置开关 false，但命中测试 override 为 true（KbHitTestService 应用 withRaptorOverride）
        RagSettings stored = raptorSettings(false, RagSettings.RAPTOR_STATUS_READY);
        RagSettings overridden = stored.withRaptorOverride(true);
        RetrieveQueryResolver.Resolution res = resolver().resolveAll(
                context(RAPTOR_CAPS, List.of(1L), overridden));

        assertTrue(res.effectiveParams().useRaptor(),
                "override=true 且能力/ready 全通过 → RAPTOR 增强必须生效");
    }

    @Test
    @DisplayName("开关关（useRaptor=false）→ 零 RAPTOR 干预，与 Wave A 行为一致")
    void raptorOffIsNoOp() {
        RagSettings settings = raptorSettings(false, RagSettings.RAPTOR_STATUS_NONE);
        RetrieveQueryResolver.Resolution res = resolver().resolveAll(
                context(RAPTOR_CAPS, List.of(1L), settings));

        assertFalse(res.effectiveParams().useRaptor());
        assertFalse(res.effectiveParams().degradedReasons().stream()
                        .anyMatch(r -> r.contains("RAPTOR")),
                "开关关时不应产生任何 RAPTOR 降级原因，实际=" + res.effectiveParams().degradedReasons());
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
