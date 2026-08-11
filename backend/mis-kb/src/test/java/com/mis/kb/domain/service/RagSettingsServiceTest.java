package com.mis.kb.domain.service;

import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.KbResultCode;
import com.mis.kb.domain.model.LibraryStatus;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.repository.KbAclRepository;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.KnowledgeEnginePort;
import com.mis.kb.engine.RagflowProperties;
import com.mis.kb.support.KbBusinessException;
import com.mis.kb.support.KbJson;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * RAG 设置校验与持久化收敛单测（T02 完成判据 / WA-01、WA-06、WA-13）。
 *
 * <p><b>补测缘由（2026-08-07 QA 门禁）：</b>设计文档 T02 把
 * {@code RagSettingsServiceTest} 列为源文件之一，但 Wave A 入库时该文件缺失，
 * 导致门禁清单第 2 条「权重落库默认 0.3 / 区间 [0,1] / rerank 无模型强制 false」
 * <b>全靠人工读码背书、零自动化证据</b>。本类补齐这段。
 *
 * <p><b>三组断言各自守什么：</b>
 * <ol>
 *   <li>{@link Validation}——越界即 {@code KB_RAG_SETTINGS_INVALID}，且
 *       <b>拒绝发生在落库之前</b>（断言 repository 零写入）。只断言抛异常是不够的：
 *       「先存后抛」同样能让异常断言变绿，但脏值已经进库了；</li>
 *   <li>{@link RerankAvailability}——WA-06 第一道防线。无全局模型时
 *       {@code rerank=true} 落库为 {@code false}，且断言的是<b>真正写进
 *       {@code rag_settings_json} 的那份 JSON</b>，不是方法返回值——
 *       两者不一致正是「界面显示已开启、库里其实是关」的经典事故形态；</li>
 *   <li>{@link WeightPersistence}——★ 主理人约束② 的落库侧对偶验证。
 *       {@code RetrieveQueryResolverTest#weightOverwriteNeverTouchesPersistedSettings}
 *       只证明了「合并器不改传入实例」，管不到保存路径；如果
 *       {@code RagSettingsService} 顺手做同款归一化，用户设的 0.4 会在切
 *       {@code vector} 保存后变成 1.0，且<b>切回 hybrid 也回不来</b>。
 *       这条链路必须在落库侧单独钉死。</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class RagSettingsServiceTest {

    private static final long LIBRARY_ID = 100L;

    @Mock
    private KbLibraryRepository libraryRepository;
    @Mock
    private KbAclRepository aclRepository;
    @Mock
    private KbDocumentRepository documentRepository;
    @Mock
    private KnowledgeEnginePort enginePort;

    private RagflowProperties propsWithRerank;
    private RagflowProperties propsWithoutRerank;
    private KbLibrary library;

    @BeforeEach
    void setUp() {
        propsWithRerank = new RagflowProperties();
        propsWithRerank.setRerankModelId("BAAI/bge-reranker-v2-m3");
        propsWithoutRerank = new RagflowProperties();
        propsWithoutRerank.setRerankModelId("");

        library = new KbLibrary();
        library.setId(LIBRARY_ID);
        library.setName("员工手册");
        library.setEngineType("ragflow");
        library.setEngineLibraryRef("ds-abc");
        library.setStatus(LibraryStatus.ENABLED.code());

        when(libraryRepository.findById(LIBRARY_ID)).thenReturn(Optional.of(library));
        when(libraryRepository.save(any(KbLibrary.class)))
                .thenAnswer(inv -> inv.getArgument(0));
    }

    private RagSettingsService serviceWithRerankModel() {
        return new RagSettingsService(libraryRepository, aclRepository,
                documentRepository, enginePort, propsWithRerank);
    }

    private RagSettingsService serviceWithoutRerankModel() {
        return new RagSettingsService(libraryRepository, aclRepository,
                documentRepository, enginePort, propsWithoutRerank);
    }

    /** 只给权重，其余字段留 null 交给 withDefaults 兜底。 */
    private static RagSettings weightOnly(Double weight) {
        return new RagSettings(null, null, null, null, null,
                null, null, null, null, weight, null);
    }

    /** 取「真正写进实体的那份 JSON」再反序列化——绕开方法返回值，看落库事实。 */
    private RagSettings persisted() {
        String json = library.getRagSettingsJson();
        assertNotNull(json, "保存后 rag_settings_json 不应为 null");
        RagSettings parsed = KbJson.readSettings(json);
        assertNotNull(parsed, "落库 JSON 必须可反序列化回 RagSettings");
        return parsed;
    }

    // ------------------------------------------------------------ 校验

    @Nested
    @DisplayName("参数校验：越界一律 KB_RAG_SETTINGS_INVALID，且拒绝先于落库")
    class Validation {

        @ParameterizedTest(name = "权重 {0} 越界 → KB_RAG_SETTINGS_INVALID")
        @ValueSource(doubles = {1.5D, -0.1D, 1.0001D, 100D})
        @DisplayName("★ WA-01：vectorSimilarityWeight 越界即拒绝，不做静默截断")
        void rejectsOutOfRangeWeight(double weight) {
            RagSettingsService service = serviceWithRerankModel();

            KbBusinessException ex = assertThrows(KbBusinessException.class,
                    () -> service.save(LIBRARY_ID, weightOnly(weight)));

            assertEquals(KbResultCode.KB_RAG_SETTINGS_INVALID.getCode(), ex.getCode());
            // 拒绝必须发生在落库之前：先存后抛同样能让上面的断言变绿，但脏值已进库
            verify(libraryRepository, never()).save(any(KbLibrary.class));
            verify(enginePort, never()).updateLibrarySettings(any(), any());
        }

        @ParameterizedTest(name = "权重 {0} 在闭区间内 → 放行")
        @ValueSource(doubles = {0.0D, 0.3D, 0.7D, 1.0D})
        @DisplayName("边界闭区间 [0,1] 两端均放行（0 与 1 不是越界）")
        void acceptsBoundaryWeights(double weight) {
            RagSettings saved = serviceWithRerankModel().save(LIBRARY_ID, weightOnly(weight));
            assertEquals(weight, saved.vectorSimilarityWeight(), 1e-9);
        }

        @Test
        @DisplayName("非法 retrievalMethod（graph）→ KB_RAG_SETTINGS_INVALID")
        void rejectsIllegalRetrievalMethod() {
            RagSettingsService service = serviceWithRerankModel();
            RagSettings bad = new RagSettings(null, null, null, null, "graph",
                    null, null, null, null, null, null);

            KbBusinessException ex = assertThrows(KbBusinessException.class,
                    () -> service.save(LIBRARY_ID, bad));
            assertEquals(KbResultCode.KB_RAG_SETTINGS_INVALID.getCode(), ex.getCode());
        }

        @Test
        @DisplayName("非法 emptyResultStrategy → KB_RAG_SETTINGS_INVALID（WA-11① 值域恒定的前提）")
        void rejectsIllegalEmptyResultStrategy() {
            RagSettingsService service = serviceWithRerankModel();
            RagSettings bad = new RagSettings(null, null, null, null, null,
                    null, null, null, "general_prompt", null, null);

            KbBusinessException ex = assertThrows(KbBusinessException.class,
                    () -> service.save(LIBRARY_ID, bad));
            assertEquals(KbResultCode.KB_RAG_SETTINGS_INVALID.getCode(), ex.getCode());
        }

        @Test
        @DisplayName("topK / threshold / chunkTokenNum 越界同样被拒")
        void rejectsOtherOutOfRangeFields() {
            RagSettingsService service = serviceWithRerankModel();

            assertThrows(KbBusinessException.class, () -> service.save(LIBRARY_ID,
                    new RagSettings(101, null, null, null, null, null, null, null, null, null, null)));
            assertThrows(KbBusinessException.class, () -> service.save(LIBRARY_ID,
                    new RagSettings(null, 1.5D, null, null, null, null, null, null, null, null, null)));
            assertThrows(KbBusinessException.class, () -> service.save(LIBRARY_ID,
                    new RagSettings(null, null, null, null, null, null, 8192, null, null, null, null)));
        }

        @ParameterizedTest(name = "chunkTokenNum={0} → KB_RAG_SETTINGS_INVALID")
        @ValueSource(ints = {255, 128, 0, -1})
        @DisplayName("chunkTokenNum 下界 256：低于 256 一律拒绝，且拒绝先于落库")
        void rejectsTokenNumBelowMin(int tokenNum) {
            RagSettingsService service = serviceWithRerankModel();
            RagSettings bad = new RagSettings(null, null, null, null, null,
                    null, tokenNum, null, null, null, null);

            KbBusinessException ex = assertThrows(KbBusinessException.class,
                    () -> service.save(LIBRARY_ID, bad));
            assertEquals(KbResultCode.KB_RAG_SETTINGS_INVALID.getCode(), ex.getCode());
            verify(libraryRepository, never()).save(any(KbLibrary.class));
            verify(enginePort, never()).updateLibrarySettings(any(), any());
        }

        @Test
        @DisplayName("chunkTokenNum 边界 [256, 4096] 两端恰好合法")
        void acceptsBoundaryTokenNum() {
            RagSettingsService service = serviceWithRerankModel();

            RagSettings savedMin = service.save(LIBRARY_ID,
                    new RagSettings(null, null, null, null, null, null, 256, null, null, null, null));
            assertEquals(256, savedMin.chunkTokenNum().intValue());

            RagSettings savedMax = service.save(LIBRARY_ID,
                    new RagSettings(null, null, null, null, null, null, 4096, null, null, null, null));
            assertEquals(4096, savedMax.chunkTokenNum().intValue());
        }
    }

    // ------------------------------------------------------------ 默认值

    @Nested
    @DisplayName("默认值：权重缺省落库 0.3，检索方式缺省 hybrid")
    class Defaults {

        @Test
        @DisplayName("★ WA-01：不传权重 → 落库 DEFAULT_VECTOR_SIMILARITY_WEIGHT(0.3)")
        void weightDefaultsToPointThree() {
            RagSettings saved = serviceWithRerankModel().save(LIBRARY_ID, weightOnly(null));

            assertEquals(RagSettings.DEFAULT_VECTOR_SIMILARITY_WEIGHT,
                    saved.vectorSimilarityWeight(), 1e-9);
            assertEquals(RagSettings.DEFAULT_VECTOR_SIMILARITY_WEIGHT,
                    persisted().vectorSimilarityWeight(), 1e-9,
                    "返回值对了但落库 JSON 不对，等于下次加载就丢");
        }

        @Test
        @DisplayName("null 设置整体回落 defaults()，不抛异常")
        void nullSettingsFallBackToDefaults() {
            RagSettings saved = serviceWithRerankModel().save(LIBRARY_ID, null);

            assertEquals(RagSettings.DEFAULT_RETRIEVAL_METHOD, saved.retrievalMethod());
            assertEquals(RagSettings.DEFAULT_TOP_K, saved.topK().intValue());
            assertEquals(RagSettings.DEFAULT_VECTOR_SIMILARITY_WEIGHT,
                    saved.vectorSimilarityWeight(), 1e-9);
        }

        @Test
        @DisplayName("get()：库内无设置时返回 defaults()，永不为 null")
        void getReturnsDefaultsWhenAbsent() {
            library.setRagSettingsJson(null);
            RagSettings got = serviceWithRerankModel().get(LIBRARY_ID);

            assertNotNull(got);
            assertEquals(RagSettings.DEFAULT_VECTOR_SIMILARITY_WEIGHT,
                    got.vectorSimilarityWeight(), 1e-9);
        }
    }

    // ------------------------------------------------------------ rerank 收敛

    @Nested
    @DisplayName("WA-06 第一道防线：无全局重排模型时 rerank 强制落 false")
    class RerankAvailability {

        @Test
        @DisplayName("★ 无 rerank-model-id + 保存 rerank=true → 落库 false（且返回值一致）")
        void rerankForcedFalseWithoutGlobalModel() {
            RagSettings request = new RagSettings(null, null, Boolean.TRUE, null, "hybrid",
                    null, null, null, null, 0.5D, null);

            RagSettings saved = serviceWithoutRerankModel().save(LIBRARY_ID, request);

            assertFalse(saved.rerank(), "返回值应已收敛为 false");
            assertFalse(persisted().rerank(),
                    "落库 JSON 必须同为 false——返回 false 但存 true 就是「显示关了实际开着」");
        }

        @Test
        @DisplayName("已配全局模型 → rerank=true 原样保留，不被误关")
        void rerankKeptWhenGlobalModelConfigured() {
            RagSettings request = new RagSettings(null, null, Boolean.TRUE, null, "hybrid",
                    null, null, null, null, 0.5D, null);

            RagSettings saved = serviceWithRerankModel().save(LIBRARY_ID, request);

            assertTrue(saved.rerank());
            assertTrue(persisted().rerank());
        }

        @Test
        @DisplayName("★ kb_settings_model_chunk：库级 rerankModelId + 全局已配 → rerank=true 且 rerankModelId 落库")
        void rerankModelIdPersistedWithGlobal() {
            RagSettings request = new RagSettings(null, null, Boolean.TRUE, null, "hybrid",
                    null, null, null, null, 0.5D, "qwen3-rerank@Tongyi-Qianwen@Tongyi-Qianwen");

            RagSettings saved = serviceWithRerankModel().save(LIBRARY_ID, request);

            assertTrue(saved.rerank());
            assertEquals("qwen3-rerank@Tongyi-Qianwen@Tongyi-Qianwen", saved.rerankModelId());
            assertEquals("qwen3-rerank@Tongyi-Qianwen@Tongyi-Qianwen", persisted().rerankModelId(),
                    "库级 rerankModelId 必须持久化进 rag_settings_json");
        }

        @Test
        @DisplayName("★ U3 闸门：全局未配时库级 rerankModelId 不参与 → rerank 仍强制关闭")
        void rerankForcedFalseWithoutGlobalEvenWithLibraryModel() {
            RagSettings request = new RagSettings(null, null, Boolean.TRUE, null, "hybrid",
                    null, null, null, null, 0.5D, "qwen3-rerank@Tongyi-Qianwen@Tongyi-Qianwen");

            RagSettings saved = serviceWithoutRerankModel().save(LIBRARY_ID, request);

            assertFalse(saved.rerank());
        }

        @Test
        @DisplayName("rerank 收敛是静默改写而非抛错（用户只是顺带带上历史值，不该整单失败）")
        void rerankConvergenceDoesNotThrow() {
            RagSettings request = new RagSettings(null, null, Boolean.TRUE, null, null,
                    null, null, null, null, null, null);

            // 不抛异常，且其余字段不受影响
            RagSettings saved = serviceWithoutRerankModel().save(LIBRARY_ID, request);
            assertFalse(saved.rerank());
            assertEquals(RagSettings.DEFAULT_TOP_K, saved.topK().intValue());
        }

        @Test
        @DisplayName("rerank=false 时不触发收敛分支，其余字段逐字保留")
        void rerankFalseIsUntouched() {
            RagSettings request = new RagSettings(20, 0.6D, Boolean.FALSE, null, "hybrid",
                    "naive", 256, null, "TRANSFER", 0.45D, null);

            RagSettings saved = serviceWithoutRerankModel().save(LIBRARY_ID, request);

            assertFalse(saved.rerank());
            assertEquals(20, saved.topK().intValue());
            assertEquals(0.45D, saved.vectorSimilarityWeight(), 1e-9);
            assertEquals("TRANSFER", saved.emptyResultStrategy());
        }
    }

    // ------------------------------------------------------------ ★ 归一化不回写（落库侧）

    @Nested
    @DisplayName("★ 主理人约束②（落库侧）：保存路径绝不按检索方式归一化权重")
    class WeightPersistence {

        @ParameterizedTest(name = "retrievalMethod={0} 时权重 0.4 仍原样落库")
        @ValueSource(strings = {"vector", "keyword", "hybrid"})
        @DisplayName("★ 设 0.4 后切任意检索方式保存，落库权重恒为 0.4")
        void weightNeverNormalizedOnSave(String method) {
            RagSettings request = new RagSettings(null, null, null, null, method,
                    null, null, null, null, 0.4D, null);

            RagSettings saved = serviceWithRerankModel().save(LIBRARY_ID, request);

            assertEquals(0.4D, saved.vectorSimilarityWeight(), 1e-9,
                    "保存 " + method + " 时权重被改写了——归一化只准发生在 Resolver 检索期");
            assertEquals(0.4D, persisted().vectorSimilarityWeight(), 1e-9,
                    "落库 JSON 中的权重被改写了，用户切回 hybrid 时会发现自己设的值不见了");
        }

        @Test
        @DisplayName("★ 端到端复现 T16-判据2：设 0.4 → 切 vector 保存 → 重新读取 → 权重仍 0.4")
        void weightSurvivesVectorRoundTrip() {
            RagSettingsService service = serviceWithRerankModel();

            // ① 以 hybrid + 0.4 保存
            service.save(LIBRARY_ID, new RagSettings(null, null, null, null, "hybrid",
                    null, null, null, null, 0.4D, null));
            assertEquals(0.4D, persisted().vectorSimilarityWeight(), 1e-9);

            // ② 切 vector 再保存（前端无条件提交当前权重值）
            service.save(LIBRARY_ID, new RagSettings(null, null, null, null, "vector",
                    null, null, null, null, 0.4D, null));

            // ③ 重新读取（模拟刷新页面后切回 hybrid）
            RagSettings reloaded = service.get(LIBRARY_ID);
            assertEquals(0.4D, reloaded.vectorSimilarityWeight(), 1e-9,
                    "切 vector 保存后权重被吃成 1.0 —— 这正是 T07-判据3 / T16-判据2 要挡的事故");
        }
    }

    // ------------------------------------------------------------ 引擎同步口径

    @Nested
    @DisplayName("引擎同步：失败不回滚本地（本地是唯一事实源）")
    class EngineSync {

        @Test
        @DisplayName("引擎同步抛异常 → 本地仍保存成功，不向上抛")
        void engineFailureDoesNotRollbackLocal() {
            doThrow(new IllegalStateException("RAGFlow 503"))
                    .when(enginePort).updateLibrarySettings(any(), any());

            RagSettings saved = serviceWithRerankModel().save(LIBRARY_ID, weightOnly(0.6D));

            assertEquals(0.6D, saved.vectorSimilarityWeight(), 1e-9);
            assertEquals(0.6D, persisted().vectorSimilarityWeight(), 1e-9);
            verify(libraryRepository).save(any(KbLibrary.class));
        }

        @Test
        @DisplayName("库无引擎映射 → 跳过同步，不空调引擎")
        void skipsSyncWhenNoEngineRef() {
            library.setEngineLibraryRef(null);

            serviceWithRerankModel().save(LIBRARY_ID, weightOnly(0.6D));

            verify(enginePort, never()).updateLibrarySettings(any(), any());
        }

        @Test
        @DisplayName("库已停用 → 跳过同步")
        void skipsSyncWhenLibraryDisabled() {
            library.setStatus(0);

            serviceWithRerankModel().save(LIBRARY_ID, weightOnly(0.6D));

            verify(enginePort, never()).updateLibrarySettings(any(), any());
        }
    }

    // ------------------------------------------------------------ OCR/overlap（KE-06/KE-07）

    @Nested
    @DisplayName("OCR/overlap：非法值拒绝；合法值落库回显（引擎不支持时仅落库不下发）")
    class OcrOverlap {

        @Test
        @DisplayName("chunkOverlapTokenNum 为负 → KB_RAG_SETTINGS_INVALID，且拒绝先于落库")
        void rejectsNegativeOverlap() {
            RagSettings bad = new RagSettings(null, null, null, null, null,
                    null, null, null, null, null, null,
                    false, "zh", -1);

            KbBusinessException ex = assertThrows(KbBusinessException.class,
                    () -> serviceWithRerankModel().save(LIBRARY_ID, bad));
            assertEquals(KbResultCode.KB_RAG_SETTINGS_INVALID.getCode(), ex.getCode());
            verify(libraryRepository, never()).save(any(KbLibrary.class));
            verify(enginePort, never()).updateLibrarySettings(any(), any());
        }

        @Test
        @DisplayName("chunkOverlapTokenNum=0（=不重叠，设计口径）→ 放行")
        void acceptsZeroOverlap() {
            RagSettings saved = serviceWithRerankModel().save(LIBRARY_ID,
                    new RagSettings(null, null, null, null, null,
                            null, null, null, null, null, null,
                            false, "zh", 0));
            assertEquals(0, saved.chunkOverlapTokenNum().intValue());
        }

        @ParameterizedTest(name = "ocrLanguage={0} → KB_RAG_SETTINGS_INVALID")
        @ValueSource(strings = {"fr", "CH", "zh_en_us", "en-US", "  "})
        @DisplayName("非法 OCR 语言码值一律拒绝（产品三档固化 zh/en/zh_en）")
        void rejectsIllegalOcrLanguage(String language) {
            RagSettings bad = new RagSettings(null, null, null, null, null,
                    null, null, null, null, null, null,
                    true, language, null);

            KbBusinessException ex = assertThrows(KbBusinessException.class,
                    () -> serviceWithRerankModel().save(LIBRARY_ID, bad));
            assertEquals(KbResultCode.KB_RAG_SETTINGS_INVALID.getCode(), ex.getCode());
        }

        @Test
        @DisplayName("合法 OCR 三字段 → 原样落库 + 回显（引擎不支持也允许保存，降级路径）")
        void validOcrFieldsPersistAndRoundTrip() {
            RagSettings request = new RagSettings(null, null, null, null, "hybrid",
                    null, null, null, null, 0.5D, null,
                    true, "zh_en", 64);

            RagSettings saved = serviceWithRerankModel().save(LIBRARY_ID, request);

            assertTrue(saved.ocrEnabled());
            assertEquals("zh_en", saved.ocrLanguage());
            assertEquals(64, saved.chunkOverlapTokenNum().intValue());
            // 落库 JSON 必须同样携带（下次加载不丢）
            assertEquals(Boolean.TRUE, persisted().ocrEnabled());
            assertEquals("zh_en", persisted().ocrLanguage());
            assertEquals(64, persisted().chunkOverlapTokenNum().intValue());

            // 重新读取（模拟刷新页面）回显一致
            RagSettings reloaded = serviceWithRerankModel().get(LIBRARY_ID);
            assertTrue(reloaded.ocrEnabled());
            assertEquals("zh_en", reloaded.ocrLanguage());
            assertEquals(64, reloaded.chunkOverlapTokenNum().intValue());
        }

        @Test
        @DisplayName("★ rerank 强制关闭（无全局模型）时 OCR 三字段必须透传不被吞")
        void ocrFieldsSurviveRerankConvergence() {
            RagSettings request = new RagSettings(null, null, Boolean.TRUE, null, "hybrid",
                    null, null, null, null, 0.5D, null,
                    true, "en", 32);

            RagSettings saved = serviceWithoutRerankModel().save(LIBRARY_ID, request);

            assertFalse(saved.rerank(), "无全局模型时 rerank 仍强制关闭");
            assertTrue(saved.ocrEnabled(),
                    "enforceRerankAvailability 用 11 参构造会把 OCR 字段吞成 null —— 必须全量透传");
            assertEquals("en", saved.ocrLanguage());
            assertEquals(32, saved.chunkOverlapTokenNum().intValue());
        }

        @Test
        @DisplayName("OCR 字段缺省 → withDefaults 兜底 ocrEnabled=false / ocrLanguage=zh")
        void ocrDefaultsApplied() {
            RagSettings saved = serviceWithRerankModel().save(LIBRARY_ID, weightOnly(0.5D));

            assertFalse(saved.ocrEnabled());
            assertEquals(RagSettings.DEFAULT_OCR_LANGUAGE, saved.ocrLanguage());
            assertTrue(saved.chunkOverlapTokenNum() == null,
                    "chunkOverlapTokenNum 缺省保持 null（=引擎默认/0，不硬编码兜底）");
        }
    }

    // ------------------------------------------------------------ 不存在的库

    @Test
    @DisplayName("库不存在 → KB_LIBRARY_NOT_FOUND，且不落库不同步")
    void missingLibraryRejected() {
        when(libraryRepository.findById(999L)).thenReturn(Optional.empty());
        RagSettingsService service = serviceWithRerankModel();

        KbBusinessException ex = assertThrows(KbBusinessException.class,
                () -> service.save(999L, weightOnly(0.5D)));

        assertEquals(KbResultCode.KB_LIBRARY_NOT_FOUND.getCode(), ex.getCode());
        verify(libraryRepository, never()).save(any(KbLibrary.class));
        verify(enginePort, never()).updateLibrarySettings(any(), any());
    }
}
