package com.mis.kb.domain.model;

import com.mis.kb.domain.service.SynonymExpandService;
import com.mis.kb.engine.RagflowProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 检索参数合并器单测（T07 验收，覆盖设计文档 §7.2 的 S1~S5）。
 *
 * <p>四类必测用例：
 * <ol>
 *   <li><b>单库生效</b>——库级设置真正参与检索（修复 D1 断点的核心验证）；</li>
 *   <li><b>多库回落</b>——回落全局默认，且不受任一库设置影响；</li>
 *   <li><b>覆盖优先</b>——命中测试的显式覆盖压过库级设置；</li>
 *   <li><b>能力降级</b>——引擎不支持 hybrid/rerank 时自动降级并记录原因。</li>
 * </ol>
 * 另附映射规则与持久化不覆写的回归用例，以及独立的 {@code RecordFallback} 组——专门验证
 * record 的 {@code effectiveVectorSimilarityWeight()} 兜底，与合并器验证分离、互不掩护。
 */
class RetrieveQueryResolverTest {

    /** 全能力引擎（ragflow + 已配重排模型）。 */
    private static final EngineCapabilities FULL = EngineCapabilities.of(true, true, true, true);
    /** 无 hybrid、无 rerank 的引擎（noop）。 */
    private static final EngineCapabilities NONE = EngineCapabilities.unsupported();

    private RagflowProperties propsWithRerank;
    private RagflowProperties propsWithoutRerank;
    private RecordingExpandService expandService;

    @BeforeEach
    void setUp() {
        propsWithRerank = new RagflowProperties();
        propsWithRerank.setRerankModelId("BAAI/bge-reranker-v2-m3");
        propsWithoutRerank = new RagflowProperties();
        propsWithoutRerank.setRerankModelId("");
        expandService = new RecordingExpandService();
    }

    /**
     * 同义词扩展服务的<b>记录型替身</b>（Wave D / T06）。
     *
     * <p>本测试类的职责是「参数合并」，不是「扩展算法」——算法正确性由
     * {@code SynonymExpandServiceTest} 独立覆盖。这里只需要证明两件事：
     * <ol>
     *   <li><b>S6 路由正确</b>：{@code AUTO}/{@code FRESH}/{@code OFF_THIS_RUN}
     *       分别落到 {@code expand(q,false)} / {@code expandFresh(q,false)} / {@code expand(q,true)}；</li>
     *   <li><b>扩展串真的被用上了</b>：{@code RetrieveQuery.question} 取的是
     *       {@code expandedQuery} 而不是原问句——这一条挂了，整个 Wave D 就是摆设。</li>
     * </ol>
     *
     * <p>用真实的 {@code SynonymExpandService} 会把词典加载、Nacos 配置一并拖进来，
     * 让本组用例在「合并逻辑没错、词典没配好」时也变红，属于典型的测试串味。
     */
    private static final class RecordingExpandService extends SynonymExpandService {

        /** 调用轨迹，形如 {@code expand(q,false)} / {@code expandFresh(q,false)}。 */
        private final List<String> calls = new ArrayList<>();

        RecordingExpandService() {
            // 替身不走父类任何逻辑，两个依赖都用不上；全部方法均被覆写，不会解引用
            super(null, null);
        }

        @Override
        public SynonymExpansion expand(String question, boolean disabledForThisRun) {
            calls.add("expand(" + question + "," + disabledForThisRun + ")");
            return disabledForThisRun
                    ? SynonymExpansion.disabled(
                            SynonymExpansion.STATUS_DISABLED_REQUEST, question,
                            SynonymBudget.defaults(), false)
                    : expanded(question);
        }

        @Override
        public SynonymExpansion expandFresh(String question, boolean disabledForThisRun) {
            calls.add("expandFresh(" + question + "," + disabledForThisRun + ")");
            return expanded(question);
        }

        /** 造一个「确实改写了问句」的扩展结果，便于断言下游是否真的采用了它。 */
        private static SynonymExpansion expanded(String question) {
            String q = question == null ? "" : question;
            return new SynonymExpansion(
                    SynonymExpansion.STATUS_EXPANDED, q, q + "＋扩展",
                    List.of(new SynonymHit(1L, "术语", "规范词", 2)),
                    List.of(), List.of(), 1, 1, false, false, SynonymBudget.defaults());
        }

        private String onlyCall() {
            assertEquals(1, calls.size(), "S6 每次合并只应调用一次扩展服务，实际调用轨迹=" + calls);
            return calls.get(0);
        }
    }

    /** 构造一份库级设置：只关心检索相关字段，其余留 null 由 withDefaults 兜底。 */
    private static RagSettings librarySettings(
            Integer topK, Double threshold, String method, Double weight,
            Boolean rerank, String emptyStrategy) {
        return new RagSettings(topK, threshold, rerank, null, method,
                null, null, null, emptyStrategy, weight).withDefaults();
    }

    private RetrieveQueryResolver resolverWithRerankModel() {
        return new RetrieveQueryResolver(propsWithRerank, expandService);
    }

    private RetrieveQueryResolver resolverWithoutRerankModel() {
        return new RetrieveQueryResolver(propsWithoutRerank, expandService);
    }

    /**
     * 断言<b>合并器产出的权重原始字段</b>，而不是 record 的 {@code effectiveXxx()} 读取器。
     *
     * <p><b>这个区分不是洁癖，是本组用例的成立前提。</b>
     * {@link RetrieveQuery#effectiveVectorSimilarityWeight()} 自带兜底：字段为 null 时
     * 它会按检索方式自己算出 vector→1.0 / keyword→0.0。也就是说，假如
     * {@code RetrieveQueryResolver.resolveWeight()} 整个不工作、权重字段留空，
     * 断言 {@code effective*()} 的 vector/keyword 用例<b>照样全绿</b>——
     * record 的兜底替合并器把答案算出来了，测试测的是「最终行为对不对」，
     * 而不是「合并器干活了没有」。而 T07 恰恰是关键路径上的核心组件，
     * 它需要被单独证明，不能靠下游兜底掩护。
     *
     * <p>record 兜底本身的正确性另由 {@link RecordFallback} 一组用例覆盖，两者分开。
     *
     * @param expected 期望权重
     * @param r        合并结果
     */
    private static void assertResolvedWeight(double expected, RetrieveQueryResolver.Resolution r) {
        Double raw = r.query().vectorSimilarityWeight();
        assertNotNull(raw,
                "合并器必须显式产出 vectorSimilarityWeight 原始字段；为 null 说明 S3 归一化没跑，"
                        + "此时 RetrieveQuery 的兜底会掩盖这个断点");
        assertEquals(expected, raw, 1e-9);
    }

    // ------------------------------------------------------------ 用例一：单库生效

    @Nested
    @DisplayName("单库检索：库级设置必须真正生效")
    class SingleLibrary {

        @Test
        @DisplayName("库配 keyword → keyword=true 语义（weight 强制 0.0），source=LIBRARY")
        void keywordLibraryTakesEffect() {
            RetrieveQueryResolver resolver = resolverWithRerankModel();
            RetrieveQueryResolver.Resolution r = resolver.resolveAll(
                    new RetrieveQueryResolver.RetrieveContext(
                            "报销标准是多少",
                            List.of(10L),
                            Map.of(10L, librarySettings(20, 0.5D, "keyword", 0.7D, false, "EMPTY")),
                            null,
                            FULL,
                            null));

            assertEquals(RagSettings.METHOD_KEYWORD, r.query().effectiveRetrievalMethod());
            // A1 验收点：keyword 下权重必须是 0.0，无论库里存的是多少（库里存的是 0.7）
            assertResolvedWeight(0.0D, r);
            assertEquals(20, r.query().effectiveTopK());
            assertEquals(0.5D, r.query().effectiveThreshold(), 1e-9);
            assertEquals(EffectiveRetrieveParams.SOURCE_LIBRARY, r.effectiveParams().source());
            assertEquals("EMPTY", r.effectiveParams().emptyResultStrategy());
            assertFalse(r.effectiveParams().degraded());
        }

        @Test
        @DisplayName("库配 hybrid + 权重 0.6 → 权重原样生效")
        void hybridWeightTakesEffect() {
            RetrieveQueryResolver resolver = resolverWithRerankModel();
            RetrieveQueryResolver.Resolution r = resolver.resolveAll(
                    new RetrieveQueryResolver.RetrieveContext(
                            "q",
                            List.of(10L),
                            Map.of(10L, librarySettings(null, null, "hybrid", 0.6D, false, null)),
                            null,
                            FULL,
                            null));

            assertEquals(RagSettings.METHOD_HYBRID, r.query().effectiveRetrievalMethod());
            assertResolvedWeight(0.6D, r);
        }

        @Test
        @DisplayName("库配 vector → 权重强制 1.0")
        void vectorForcesFullWeight() {
            RetrieveQueryResolver resolver = resolverWithRerankModel();
            RetrieveQueryResolver.Resolution r = resolver.resolveAll(
                    new RetrieveQueryResolver.RetrieveContext(
                            "q",
                            List.of(10L),
                            Map.of(10L, librarySettings(null, null, "vector", 0.4D, false, null)),
                            null,
                            FULL,
                            null));

            assertEquals(RagSettings.METHOD_VECTOR, r.query().effectiveRetrievalMethod());
            assertResolvedWeight(1.0D, r);
        }

        @Test
        @DisplayName("库开 rerank 且已配全局模型 → 下发 rerank_id")
        void rerankEnabledSendsModelId() {
            RetrieveQueryResolver resolver = resolverWithRerankModel();
            RetrieveQueryResolver.Resolution r = resolver.resolveAll(
                    new RetrieveQueryResolver.RetrieveContext(
                            "q",
                            List.of(10L),
                            Map.of(10L, librarySettings(null, null, "hybrid", null, true, null)),
                            null,
                            FULL,
                            null));

            assertTrue(r.query().effectiveRerank());
            assertTrue(r.query().shouldSendRerankId());
            assertEquals("BAAI/bge-reranker-v2-m3", r.query().rerankModelId());
            assertFalse(r.effectiveParams().degraded());
        }

        @Test
        @DisplayName("库无任何设置 → 回落全局默认，但 source 仍标 LIBRARY（范围是单库）")
        void missingSettingsFallsBackToDefaults() {
            RetrieveQueryResolver resolver = resolverWithRerankModel();
            RetrieveQueryResolver.Resolution r = resolver.resolveAll(
                    new RetrieveQueryResolver.RetrieveContext(
                            "q", List.of(10L), Map.of(), null, FULL, null));

            assertEquals(RagSettings.DEFAULT_RETRIEVAL_METHOD, r.query().effectiveRetrievalMethod());
            assertResolvedWeight(RagSettings.DEFAULT_VECTOR_SIMILARITY_WEIGHT, r);
            assertEquals(RagSettings.DEFAULT_TOP_K, r.query().effectiveTopK());
        }
    }

    // ------------------------------------------------------------ 用例二：多库回落

    @Nested
    @DisplayName("多库检索：一律回落全局默认（决策⑥）")
    class MultiLibrary {

        @Test
        @DisplayName("两个库各配一套参数 → 生效参数等于全局默认，不随任一库变化")
        void multiLibraryUsesGlobalDefaults() {
            RetrieveQueryResolver resolver = resolverWithRerankModel();
            RetrieveQueryResolver.Resolution r = resolver.resolveAll(
                    new RetrieveQueryResolver.RetrieveContext(
                            "q",
                            List.of(10L, 20L),
                            Map.of(
                                    10L, librarySettings(50, 0.9D, "keyword", 0.1D, true, "TRANSFER"),
                                    20L, librarySettings(3, 0.1D, "vector", 0.9D, true, "EMPTY")),
                            null,
                            FULL,
                            null));

            RagSettings defaults = RagSettings.defaults();
            assertEquals(EffectiveRetrieveParams.SOURCE_GLOBAL_DEFAULT, r.effectiveParams().source());
            assertEquals(defaults.retrievalMethod(), r.query().effectiveRetrievalMethod());
            assertResolvedWeight(defaults.vectorSimilarityWeight(), r);
            assertEquals(defaults.topK().intValue(), r.query().effectiveTopK());
            assertEquals(defaults.scoreThreshold(), r.query().effectiveThreshold(), 1e-9);
            // U7：策略也跟着回落全局默认，不做「参数用全局、策略用库级」的割裂
            assertEquals(EmptyResultStrategy.SUGGEST.code(),
                    r.effectiveParams().emptyResultStrategy());
            // 两个库都开了 rerank，但全局默认是关，所以不启用
            assertFalse(r.query().effectiveRerank());
        }

        @Test
        @DisplayName("空库集合 → 空结果策略取全局默认")
        void emptyScopeUsesDefaultStrategy() {
            RetrieveQueryResolver resolver = resolverWithRerankModel();
            assertEquals(EmptyResultStrategy.SUGGEST.code(),
                    resolver.resolveEmptyResultStrategy(List.of(), Map.of()));
        }

        @Test
        @DisplayName("单库时空结果策略取该库设置")
        void singleScopeUsesLibraryStrategy() {
            RetrieveQueryResolver resolver = resolverWithRerankModel();
            assertEquals("TRANSFER", resolver.resolveEmptyResultStrategy(
                    List.of(10L),
                    Map.of(10L, librarySettings(null, null, null, null, null, "TRANSFER"))));
        }
    }

    // ------------------------------------------------------------ 用例三：覆盖优先

    @Nested
    @DisplayName("显式覆盖：优先级最高（命中测试调参）")
    class RequestOverride {

        @Test
        @DisplayName("覆盖检索方式与权重 → 压过库级设置，source=REQUEST_OVERRIDE")
        void overrideBeatsLibrary() {
            RetrieveQueryResolver resolver = resolverWithRerankModel();
            RetrieveQueryResolver.Resolution r = resolver.resolveAll(
                    new RetrieveQueryResolver.RetrieveContext(
                            "q",
                            List.of(10L),
                            Map.of(10L, librarySettings(5, 0.2D, "keyword", 0.1D, false, null)),
                            new RetrieveQueryResolver.ParamOverride(
                                    30, 0.75D, "hybrid", 0.8D, true),
                            FULL,
                            null));

            assertEquals(EffectiveRetrieveParams.SOURCE_REQUEST_OVERRIDE,
                    r.effectiveParams().source());
            assertEquals(RagSettings.METHOD_HYBRID, r.query().effectiveRetrievalMethod());
            assertResolvedWeight(0.8D, r);
            assertEquals(30, r.query().effectiveTopK());
            assertEquals(0.75D, r.query().effectiveThreshold(), 1e-9);
            assertTrue(r.query().effectiveRerank());
        }

        @Test
        @DisplayName("部分覆盖：只覆盖 topK，其余仍取库级")
        void partialOverrideKeepsRest() {
            RetrieveQueryResolver resolver = resolverWithRerankModel();
            RetrieveQueryResolver.Resolution r = resolver.resolveAll(
                    new RetrieveQueryResolver.RetrieveContext(
                            "q",
                            List.of(10L),
                            Map.of(10L, librarySettings(5, 0.2D, "keyword", 0.1D, false, null)),
                            new RetrieveQueryResolver.ParamOverride(30, null, null, null, null),
                            FULL,
                            null));

            assertEquals(30, r.query().effectiveTopK());
            assertEquals(RagSettings.METHOD_KEYWORD, r.query().effectiveRetrievalMethod());
            assertEquals(0.2D, r.query().effectiveThreshold(), 1e-9);
        }

        @Test
        @DisplayName("全空覆盖等价于不覆盖，source 保持 LIBRARY")
        void emptyOverrideIsNoOp() {
            RetrieveQueryResolver resolver = resolverWithRerankModel();
            RetrieveQueryResolver.Resolution r = resolver.resolveAll(
                    new RetrieveQueryResolver.RetrieveContext(
                            "q",
                            List.of(10L),
                            Map.of(10L, librarySettings(7, null, "vector", null, false, null)),
                            RetrieveQueryResolver.ParamOverride.none(),
                            FULL,
                            null));

            assertEquals(EffectiveRetrieveParams.SOURCE_LIBRARY, r.effectiveParams().source());
            assertEquals(7, r.query().effectiveTopK());
        }
    }

    // ------------------------------------------------------------ 用例四：能力降级

    @Nested
    @DisplayName("能力降级：不支持就降级并记录原因")
    class CapabilityDegradation {

        @Test
        @DisplayName("引擎不支持 hybrid → 降级为 vector，权重 1.0，记 1 条原因")
        void hybridDegradesToVector() {
            RetrieveQueryResolver resolver = resolverWithRerankModel();
            RetrieveQueryResolver.Resolution r = resolver.resolveAll(
                    new RetrieveQueryResolver.RetrieveContext(
                            "q",
                            List.of(10L),
                            Map.of(10L, librarySettings(null, null, "hybrid", 0.6D, false, null)),
                            null,
                            NONE,
                            null));

            assertEquals(RagSettings.METHOD_VECTOR, r.query().effectiveRetrievalMethod());
            assertResolvedWeight(1.0D, r);
            assertTrue(r.effectiveParams().degraded());
            assertEquals(1, r.effectiveParams().degradedReasons().size());
        }

        @Test
        @DisplayName("引擎不支持 rerank → 关闭并记原因（同时 hybrid 也降级，共 2 条）")
        void rerankDegradesWhenUnsupported() {
            RetrieveQueryResolver resolver = resolverWithRerankModel();
            RetrieveQueryResolver.Resolution r = resolver.resolveAll(
                    new RetrieveQueryResolver.RetrieveContext(
                            "q",
                            List.of(10L),
                            Map.of(10L, librarySettings(null, null, "hybrid", null, true, null)),
                            null,
                            NONE,
                            null));

            assertFalse(r.query().effectiveRerank());
            assertFalse(r.query().shouldSendRerankId());
            assertNull(r.query().rerankModelId());
            assertEquals(2, r.effectiveParams().degradedReasons().size());
        }

        @Test
        @DisplayName("引擎支持 rerank 但平台未配模型 → 仍关闭（第三道防线）")
        void rerankDegradesWhenNoGlobalModel() {
            RetrieveQueryResolver resolver = resolverWithoutRerankModel();
            RetrieveQueryResolver.Resolution r = resolver.resolveAll(
                    new RetrieveQueryResolver.RetrieveContext(
                            "q",
                            List.of(10L),
                            Map.of(10L, librarySettings(null, null, "hybrid", null, true, null)),
                            null,
                            FULL,
                            null));

            assertFalse(r.query().effectiveRerank());
            assertNull(r.effectiveParams().rerankModelId());
            assertEquals(1, r.effectiveParams().degradedReasons().size());
            assertTrue(r.effectiveParams().degradedReasons().get(0).contains("全局重排模型"));
        }

        @Test
        @DisplayName("未降级时 degradedReasons 为空列表而非 null")
        void noDegradationYieldsEmptyList() {
            RetrieveQueryResolver resolver = resolverWithRerankModel();
            RetrieveQueryResolver.Resolution r = resolver.resolveAll(
                    new RetrieveQueryResolver.RetrieveContext(
                            "q", List.of(10L), Map.of(), null, FULL, null));

            assertNotNull(r.effectiveParams().degradedReasons());
            assertTrue(r.effectiveParams().degradedReasons().isEmpty());
        }
    }

    // ------------------------------------------------------------ 边界与回归

    @Nested
    @DisplayName("边界兜底与回归")
    class Boundaries {

        @Test
        @DisplayName("topK 越界钳制到 [1,100]，阈值钳制到 [0,1]")
        void clampsOutOfRangeValues() {
            RetrieveQueryResolver resolver = resolverWithRerankModel();
            RetrieveQueryResolver.Resolution high = resolver.resolveAll(
                    new RetrieveQueryResolver.RetrieveContext(
                            "q", List.of(10L), Map.of(), 
                            new RetrieveQueryResolver.ParamOverride(999, 5.0D, null, 3.0D, null),
                            FULL,
                            null));
            assertEquals(RetrieveQueryResolver.MAX_TOP_K, high.query().effectiveTopK());
            assertEquals(1.0D, high.query().effectiveThreshold(), 1e-9);
            assertResolvedWeight(1.0D, high);

            RetrieveQueryResolver.Resolution low = resolver.resolveAll(
                    new RetrieveQueryResolver.RetrieveContext(
                            "q", List.of(10L), Map.of(),
                            new RetrieveQueryResolver.ParamOverride(0, -1.0D, null, -0.5D, null),
                            FULL,
                            null));
            assertEquals(RetrieveQueryResolver.MIN_TOP_K, low.query().effectiveTopK());
            assertEquals(0.0D, low.query().effectiveThreshold(), 1e-9);
            assertResolvedWeight(0.0D, low);
        }

        @Test
        @DisplayName("非法检索方式回落 hybrid")
        void illegalMethodFallsBackToHybrid() {
            RetrieveQueryResolver resolver = resolverWithRerankModel();
            RetrieveQueryResolver.Resolution r = resolver.resolveAll(
                    new RetrieveQueryResolver.RetrieveContext(
                            "q",
                            List.of(10L),
                            Map.of(10L, new RagSettings(null, null, null, null, "graph",
                                    null, null, null, null, null)),
                            null,
                            FULL,
                            null));
            assertEquals(RagSettings.METHOD_HYBRID, r.query().effectiveRetrievalMethod());
        }

        @Test
        @DisplayName("非法空结果策略回落 SUGGEST，取值恒在三值域内")
        void illegalStrategyFallsBackToSuggest() {
            RetrieveQueryResolver resolver = resolverWithRerankModel();
            RetrieveQueryResolver.Resolution r = resolver.resolveAll(
                    new RetrieveQueryResolver.RetrieveContext(
                            "q",
                            List.of(10L),
                            Map.of(10L, new RagSettings(null, null, null, null, null,
                                    null, null, null, "general_prompt", null)),
                            null,
                            FULL,
                            null));
            assertTrue(EmptyResultStrategy.isValid(r.effectiveParams().emptyResultStrategy()));
            assertEquals(EmptyResultStrategy.SUGGEST.code(),
                    r.effectiveParams().emptyResultStrategy());
        }

        @Test
        @DisplayName("主理人约束②回归：非 hybrid 的强制覆写只在合并期，不改库级原值")
        void weightOverwriteNeverTouchesPersistedSettings() {
            RagSettings stored = librarySettings(null, null, "vector", 0.4D, false, null);
            RetrieveQueryResolver resolver = resolverWithRerankModel();
            RetrieveQueryResolver.Resolution r = resolver.resolveAll(
                    new RetrieveQueryResolver.RetrieveContext(
                            "q", List.of(10L), Map.of(10L, stored), null, FULL, null));

            // 检索期：vector 强制 1.0
            assertResolvedWeight(1.0D, r);
            // 库级原值：仍是用户设的 0.4，一个字节都没动
            assertEquals(0.4D, stored.vectorSimilarityWeight(), 1e-9);
        }

        @Test
        @DisplayName("null 上下文不抛异常，全部走默认")
        void nullContextIsSafe() {
            RetrieveQueryResolver resolver = resolverWithRerankModel();
            RetrieveQueryResolver.Resolution r = resolver.resolveAll(null);
            assertNotNull(r.query());
            assertNotNull(r.effectiveParams());
            assertEquals(RagSettings.DEFAULT_TOP_K, r.query().effectiveTopK());
            // Wave D 回归：null ctx 不能因为多了一个 synonymMode 字段就炸
            assertNotNull(r.expansion(), "expansion 恒非 null，下游不该写判空");
        }
    }

    // ------------------------------------------------------------ S6：同义词扩展（Wave D）

    /**
     * S6 路由与接线验证（T06 完成判据）。
     *
     * <p>不验算法，只验<b>接线</b>：模式选对了没、扩展串用上了没、轨迹挂上了没。
     */
    @Nested
    @DisplayName("S6 同义词扩展：模式路由与扩展串接线")
    class SynonymStep {

        private RetrieveQueryResolver.Resolution resolveWithMode(SynonymMode mode) {
            return resolverWithRerankModel().resolveAll(
                    new RetrieveQueryResolver.RetrieveContext(
                            "OKR 怎么填", List.of(10L), Map.of(), null, FULL, mode));
        }

        @Test
        @DisplayName("AUTO → 走热路径 expand(q,false)，不做版本校验")
        void autoUsesHotPath() {
            RetrieveQueryResolver.Resolution r = resolveWithMode(SynonymMode.AUTO);
            assertEquals("expand(OKR 怎么填,false)", expandService.onlyCall());
            assertEquals(SynonymExpansion.STATUS_EXPANDED, r.expansion().status());
        }

        @Test
        @DisplayName("模式为 null → 收敛成 AUTO（老调用方语义不变）")
        void nullModeFallsBackToAuto() {
            resolveWithMode(null);
            assertEquals("expand(OKR 怎么填,false)", expandService.onlyCall());
        }

        @Test
        @DisplayName("FRESH → 走 expandFresh(q,false)，即 Q7「保存后可立即验证」的兑现点")
        void freshUsesVersionCheckedPath() {
            resolveWithMode(SynonymMode.FRESH);
            assertEquals("expandFresh(OKR 怎么填,false)", expandService.onlyCall());
        }

        @Test
        @DisplayName("OFF_THIS_RUN → 走 expand(q,true) 而非 expandFresh：本次不扩展就不该白花一次版本校验")
        void offThisRunShortCircuitsWithoutFreshCheck() {
            RetrieveQueryResolver.Resolution r = resolveWithMode(SynonymMode.OFF_THIS_RUN);
            assertEquals("expand(OKR 怎么填,true)", expandService.onlyCall());
            assertEquals(SynonymExpansion.STATUS_DISABLED_REQUEST, r.expansion().status());
            // AC-02：未扩展时送引擎的串必须逐字符等于原问句
            assertEquals("OKR 怎么填", r.query().question());
            assertEquals(r.expansion().originalQuestion(), r.expansion().expandedQuery());
        }

        @Test
        @DisplayName("★ 送引擎的 question 必须是 expandedQuery，不是用户原话（§7.3）")
        void queryCarriesExpandedString() {
            RetrieveQueryResolver.Resolution r = resolveWithMode(SynonymMode.AUTO);
            assertEquals("OKR 怎么填＋扩展", r.query().question(),
                    "RetrieveQuery.question 的语义是「实际送引擎的串」；"
                            + "取了原问句就等于扩展白做，Wave D 全波次失效");
            assertEquals("OKR 怎么填", r.expansion().originalQuestion(),
                    "原话必须原样留在轨迹里，供命中测试对照展示");
        }

        @Test
        @DisplayName("扩展不影响参数合并：降级原因与 source 照常产出")
        void expansionDoesNotDisturbParamMerge() {
            RetrieveQueryResolver.Resolution r = resolverWithRerankModel().resolveAll(
                    new RetrieveQueryResolver.RetrieveContext(
                            "q",
                            List.of(10L),
                            Map.of(10L, librarySettings(null, null, "hybrid", 0.6D, false, null)),
                            null,
                            NONE,
                            SynonymMode.AUTO));

            assertEquals(RagSettings.METHOD_VECTOR, r.query().effectiveRetrievalMethod());
            assertEquals(1, r.effectiveParams().degradedReasons().size());
            assertEquals(SynonymExpansion.STATUS_EXPANDED, r.expansion().status());
        }
    }

    // ------------------------------------------------------------ 记录级兜底（与合并器验证分离）

    /**
     * 独立于合并器的验证组：只测 {@link RetrieveQuery#effectiveVectorSimilarityWeight()} 的兜底。
     *
     * <p>本组刻意<b>不走合并器</b>——直接用 9 参构造造出 {@code vectorSimilarityWeight} 为
     * {@code null} 的 record，证明兜底逻辑本身正确。它与上面的 {@link #assertResolvedWeight}
     * 组构成「两道防线」：一组证明「合并器显式产出了权重」，一组证明「即便没产出，record 也有兜底」。
     * 两者分开，互不掩护——合并器挂了不应被兜底掩盖，兜底挂了也不应被合并器掩盖。
     */
    @Nested
    @DisplayName("记录级兜底：effectiveVectorSimilarityWeight() 在原始字段为 null 时的行为")
    class RecordFallback {

        @Test
        @DisplayName("vector + 权重为 null → 兜底 1.0，且原始字段仍为 null")
        void vectorFallsBackToOne() {
            RetrieveQuery q = new RetrieveQuery(
                    "q", List.of(10L), 5, 0.3D,
                    RagSettings.METHOD_VECTOR, null, false, null, "SUGGEST");
            assertEquals(1.0D, q.effectiveVectorSimilarityWeight(), 1e-9);
            assertNull(q.vectorSimilarityWeight(),
                    "走兜底路径时原始字段必须仍是 null——这正是与合并器产出的区别");
        }

        @Test
        @DisplayName("keyword + 权重为 null → 兜底 0.0，且原始字段仍为 null")
        void keywordFallsBackToZero() {
            RetrieveQuery q = new RetrieveQuery(
                    "q", List.of(10L), 5, 0.3D,
                    RagSettings.METHOD_KEYWORD, null, false, null, "SUGGEST");
            assertEquals(0.0D, q.effectiveVectorSimilarityWeight(), 1e-9);
            assertNull(q.vectorSimilarityWeight());
        }

        @Test
        @DisplayName("hybrid + 权重为 null → 兜底 DEFAULT_VECTOR_SIMILARITY_WEIGHT(0.3)")
        void hybridFallsBackToDefaultWeight() {
            RetrieveQuery q = new RetrieveQuery(
                    "q", List.of(10L), 5, 0.3D,
                    RagSettings.METHOD_HYBRID, null, false, null, "SUGGEST");
            assertEquals(RagSettings.DEFAULT_VECTOR_SIMILARITY_WEIGHT,
                    q.effectiveVectorSimilarityWeight(), 1e-9);
            assertNull(q.vectorSimilarityWeight());
        }

        @Test
        @DisplayName("权重已显式设置 → effective 直接采用，不触发兜底（与合并器产出对齐）")
        void explicitWeightNotOverriddenByFallback() {
            RetrieveQuery q = new RetrieveQuery(
                    "q", List.of(10L), 5, 0.3D,
                    RagSettings.METHOD_HYBRID, 0.6D, false, null, "SUGGEST");
            assertEquals(0.6D, q.effectiveVectorSimilarityWeight(), 1e-9);
            assertEquals(0.6D, q.vectorSimilarityWeight(), 1e-9);
        }
    }
}
