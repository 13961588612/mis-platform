package com.mis.kb.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.common.core.exception.BusinessException;
import com.mis.kb.domain.entity.KbDocument;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.ChunkHit;
import com.mis.kb.domain.model.EngineDocumentRef;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.model.RetrieveQuery;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.mis.kb.engine.dto.RfChunk;
import com.mis.kb.engine.dto.RfRetrievalData;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * B1/B2 修复的独立回归验证（QA 门禁，2026-08-11）。
 *
 * <p>与 BFF 模块 {@code KbWebClientUriEncodingTest} 同构：用 JDK 自带
 * {@link HttpServer} 起一个本地假 RAGFlow，让<b>真实</b> {@link RestClient}
 * 打真实 HTTP 请求，再对「线上字节」做断言。任何 Mock 都可能在请求定型前
 * 把行踪截走，从而测不到真正发出去的那一行请求；这里拿到的 method / path /
 * Authorization / body 就是 RAGFlow 侧会看到的字节。
 *
 * <p>守四条铁律（对应修复声明）：
 * <ol>
 *   <li><b>B2-①</b> {@code updateDatasetSettings} 必须发 <b>PUT</b>（不是 POST）；
 *       旧实现用 POST 打 {@code /api/v1/datasets/{id}}，本实例 405，设置从未到达引擎；
 *       且 body 只含白名单四键，<b>不得</b>出现 {@code top_k} /
 *       {@code similarity_threshold} / {@code vector_similarity_weight}（pydantic
 *       extra=forbid 会整单拒收 code:101）；</li>
 *   <li><b>B2-②</b> ★ P1f（Wave C）：每次 PUT 恒携带 {@code chunk_method} + 完整
 *       {@code parser_config}（含 raptor + graphrag 子对象，布尔按 MIS 开关原样下发），
 *       即使仅改检索期参数或 settings 为 null——否则切过 chunk_method 后 RAPTOR/图谱
 *       配置会被引擎重置且 MIS 无从感知；</li>
 *   <li><b>B1-①</b> {@code updateDocumentEnabled} 发 PUT + body {@code enabled}
 *       为<b>整数 0/1</b>（布尔会被拒 code:102）；</li>
 *   <li><b>B1-②</b> 适配器 {@code setDocumentEnabled} 走的是 PUT 启停（不是 DELETE 删除），
 *       {@code retrieve} 本地 enabled≠1 的 chunk 被丢弃、doc==null 维持旧行为透传；</li>
 *   <li><b>B3-①</b> {@code retrieve} 请求体为<b>顶层扁平字段</b>（question/dataset_ids/
 *       page_size/similarity_threshold/keyword/vector_similarity_weight），<b>不得</b>出现
 *       嵌套 {@code retrieval_setting}（该实例静默忽略，参数等于没传）；{@code page_size}
 *       落 {@code effectiveTopK()}，{@code top_k} 不再下发；rerank_id 缺省时连键都不出现。</li>
 *   <li><b>B3-②</b> hybrid 检索方式必须发 {@code keyword:false}（旧实现发 true，
 *       该实例 keyword=true 走全文候选，query 无全文命中即 0 条——「甚至可能空结果」的直接根因）；
 *       vector→false、keyword→true。</li>
 *   <li><b>B3-③</b> 响应 {@code data} 是对象 {@code {chunks, doc_aggs, total}}，chunk 字段
 *       为 {@code content}/{@code similarity}/{@code document_keyword}（不是
 *       text/score/document_name）——旧 DTO 会把正文/分数/文档名全解成 null。</li>
 * </ol>
 */
class RagflowClientHttpTest {

    private static final String API_KEY = "test-api-key";

    private HttpServer server;
    private final AtomicInteger requestCount = new AtomicInteger();
    private final AtomicReference<String> lastMethod = new AtomicReference<>();
    private final AtomicReference<String> lastPath = new AtomicReference<>();
    private final AtomicReference<String> lastAuth = new AtomicReference<>();
    private final AtomicReference<String> lastBody = new AtomicReference<>();

    private final ObjectMapper mapper = new ObjectMapper();
    private RagflowProperties props;
    private String baseUrl;

    @BeforeEach
    void setUp() throws IOException {
        requestCount.set(0);
        lastMethod.set(null);
        lastPath.set(null);
        lastAuth.set(null);
        lastBody.set(null);

        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            requestCount.incrementAndGet();
            lastMethod.set(exchange.getRequestMethod());
            lastPath.set(exchange.getRequestURI().getPath());
            lastAuth.set(exchange.getRequestHeaders().getFirst("Authorization"));
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            lastBody.set(body);

            String response;
            String path = exchange.getRequestURI().getPath();
            if (path.equals("/api/v1/retrieval")) {
                // B3 实测：data 是对象 {chunks, doc_aggs, total}，不是数组；chunk 字段是
                // content/similarity/document_keyword（不是 text/score/document_name）
                response = "{\"code\":0,\"message\":\"ok\",\"data\":{\"chunks\":["
                        + chunk("doc-disabled", "a.pdf", "t1", 0.9) + ","
                        + chunk("doc-enabled", "b.pdf", "t2", 0.8) + ","
                        + chunk("doc-unknown", "c.pdf", "t3", 0.7)
                        + "],\"doc_aggs\":[],\"total\":3}}";
            } else if (path.endsWith("/documents/doc-fail")) {
                // RAGFlow pydantic 拒绝布尔的指纹：code:102
                response = "{\"code\":102,\"message\":\"Input should be a valid integer\",\"data\":null}";
            } else if (path.matches(".*/documents/.*")) {
                response = "{\"code\":0,\"message\":\"ok\",\"data\":{\"id\":\"doc-x\",\"name\":\"x\"}}";
            } else {
                response = "{\"code\":0,\"message\":\"ok\",\"data\":{\"id\":\"ds-x\",\"name\":\"x\"}}";
            }
            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        });
        server.start();

        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
        props = new RagflowProperties();
        props.setBaseUrl(baseUrl);
        props.setApiKey(API_KEY);
    }

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    private RagflowClient newClient() {
        return new RagflowClient(RestClient.builder(), baseUrl, API_KEY);
    }

    private RagflowAdapter newAdapter(KbLibraryRepository libRepo, KbDocumentRepository docRepo) {
        return new RagflowAdapter(props, RestClient.builder(), libRepo, docRepo);
    }

    /** 全字段都给的设置：只有白名单字段应到达引擎。 */
    private static RagSettings fullSettings() {
        return new RagSettings(
                20,                    // topK —— 检索期参数，不应下发
                0.6D,                  // scoreThreshold —— 检索期参数，不应下发
                Boolean.TRUE,          // rerank —— 不在白名单
                "BAAI/bge-m3",         // embeddingModel —— 白名单
                "hybrid",              // retrievalMethod —— 不在白名单
                "naive",               // chunkMethod —— 白名单
                512,                   // chunkTokenNum —— parser_config 白名单
                "###",                 // separator —— parser_config.delimiter 白名单
                null,
                null,
                null);
    }

    private static String chunk(String docId, String name, String text, double score) {
        // B3 实测字段名：content / similarity / document_keyword（不是 text / score / document_name）
        return "{\"document_id\":\"" + docId + "\",\"document_keyword\":\"" + name
                + "\",\"content\":\"" + text + "\",\"similarity\":" + score + "}";
    }

    @Nested
    @DisplayName("B2：分隔符 ### 切分无效果 —— updateDatasetSettings 走 PUT 且字段白名单")
    class UpdateDatasetSettings {

        @Test
        @DisplayName("HTTP 方法必须是 PUT（旧实现 POST → 本实例 405，设置从未到达引擎）")
        void usesPutNotPost() {
            newClient().updateDatasetSettings("ds-1", fullSettings());

            assertEquals("PUT", lastMethod.get(),
                    "修复前这里会是 POST，RAGFlow 返回 405 MethodNotAllowed");
            assertEquals("/api/v1/datasets/ds-1", lastPath.get());
        }

        @Test
        @DisplayName("Authorization 头与异常处理与既有 postFor 一致（Bearer + apiKey）")
        void carriesBearerAuth() {
            newClient().updateDatasetSettings("ds-1", fullSettings());

            assertEquals("Bearer " + API_KEY, lastAuth.get());
        }

        @Test
        @DisplayName("body 只含白名单：embedding_model / chunk_method / parser_config(delimiter,chunk_token_num)")
        void bodyContainsOnlyWhitelistedKeys() throws Exception {
            newClient().updateDatasetSettings("ds-1", fullSettings());

            JsonNode body = mapper.readTree(lastBody.get());
            assertEquals("BAAI/bge-m3", body.get("embedding_model").asText());
            assertEquals("naive", body.get("chunk_method").asText());
            assertEquals(512, body.get("parser_config").get("chunk_token_num").asInt());
            assertEquals("###", body.get("parser_config").get("delimiter").asText(),
                    "分隔符必须落到 parser_config.delimiter —— 这是 Bug 2 的核心修复点");
        }

        @Test
        @DisplayName("top_k / similarity_threshold / vector_similarity_weight / retrieval_method / rerank 一律不下发")
        void noRetrievalPeriodParamsInDatasetBody() throws Exception {
            newClient().updateDatasetSettings("ds-1", fullSettings());

            JsonNode body = mapper.readTree(lastBody.get());
            assertFalse(body.has("top_k"),
                    "top_k 是检索期参数，本实例 PUT body 为 pydantic 严格校验，出现即整单拒收 code:101");
            assertFalse(body.has("similarity_threshold"));
            assertFalse(body.has("vector_similarity_weight"));
            assertFalse(body.has("retrieval_method"));
            assertFalse(body.has("rerank"));
        }

        @Test
        @DisplayName("★ P1f：仅改 topK/scoreThreshold（检索期参数）→ 仍发 PUT，且携带默认 chunk_method + 完整 parser_config")
        void sendsFullBodyEvenWhenOnlyRetrievalParamsChanged() throws Exception {
            RagSettings onlyTopK = new RagSettings(30, null, null, null, null,
                    null, null, null, null, null, null);

            newClient().updateDatasetSettings("ds-1", onlyTopK);

            assertEquals(1, requestCount.get(),
                    "P1f：每次 PUT 都必须携带 chunk_method + 完整 parser_config，即使检索期参数单独变更");
            JsonNode body = mapper.readTree(lastBody.get());
            assertEquals("naive", body.get("chunk_method").asText(),
                    "未设置 chunkMethod → 兜底默认 naive（避免引擎沿用上一轮 chunk_method 残留）");
            assertTrue(body.get("parser_config").has("raptor"),
                    "raptor 子对象恒下发（P1f）");
            assertFalse(body.get("parser_config").get("raptor").get("use_raptor").asBoolean(),
                    "useRaptor=false → use_raptor:false 原样下发");
            assertTrue(body.get("parser_config").has("graphrag"),
                    "graphrag 子对象恒下发（P1f）");
            assertFalse(body.get("parser_config").get("graphrag").get("use_graphrag").asBoolean(),
                    "useKnowledgeGraph=false → use_graphrag:false 原样下发");
        }

        @Test
        @DisplayName("★ P1f：null 设置 → 仍发 PUT，且按默认模板下发 chunk_method + 完整 parser_config")
        void nullSettingsStillSendsFullDefaultBody() throws Exception {
            newClient().updateDatasetSettings("ds-1", null);

            assertEquals(1, requestCount.get(),
                    "P1f：null 设置也按默认模板下发（use_raptor=false / use_graphrag=false / naive），"
                            + "不允许空 body 让引擎沿用上一轮残留");
            JsonNode body = mapper.readTree(lastBody.get());
            assertEquals("naive", body.get("chunk_method").asText());
            assertTrue(body.get("parser_config").has("raptor"));
            assertFalse(body.get("parser_config").get("raptor").get("use_raptor").asBoolean());
            assertTrue(body.get("parser_config").has("graphrag"));
            assertFalse(body.get("parser_config").get("graphrag").get("use_graphrag").asBoolean());
        }

        @Test
        @DisplayName("★ U6 + P1f：useRaptor=true 全参 → raptor 子对象 5 字段正确下发，且绝不出现 random_seed")
        void raptorSubObjectSerializedWithoutRandomSeed() throws Exception {
            RagSettings raptorOn = new RagSettings(
                    20, 0.6D, Boolean.TRUE, "BAAI/bge-m3", "hybrid", "naive",
                    512, "###", null, null, null,
                    null, null, null, null, null, null,
                    Boolean.TRUE, 1024, 0.2D, 32, "custom prompt", null, null);

            newClient().updateDatasetSettings("ds-1", raptorOn);

            JsonNode body = mapper.readTree(lastBody.get());
            JsonNode raptor = body.get("parser_config").get("raptor");
            assertTrue(raptor.get("use_raptor").asBoolean(),
                    "useRaptor=true → use_raptor:true 原样下发（P1f）");
            assertEquals(1024, raptor.get("max_token").asInt());
            assertEquals(0.2, raptor.get("threshold").asDouble(), 0.0001);
            assertEquals(32, raptor.get("max_cluster").asInt());
            assertEquals("custom prompt", raptor.get("prompt").asText());
            assertFalse(raptor.has("random_seed"),
                    "U6：引擎字段名是 random_seed（写 seed → code:101），MIS 不下发该键走引擎默认");
            // graphrag 子对象仍恒在（P1c：与 raptor 可共存）
            assertTrue(body.get("parser_config").has("graphrag"));
            assertFalse(body.get("parser_config").get("graphrag").get("use_graphrag").asBoolean());
        }

        @Test
        @DisplayName("★ P1f：useKnowledgeGraph=true → graphrag 子对象带 method=light，且 raptor 子对象仍恒在")
        void graphragSubObjectCoexistsWithRaptor() throws Exception {
            RagSettings graphOn = new RagSettings(
                    20, 0.6D, Boolean.TRUE, "BAAI/bge-m3", "hybrid", "naive",
                    512, "###", null, null, null,
                    null, null, null, Boolean.TRUE, "ready", null,
                    Boolean.TRUE, 1024, 0.1D, 64, null, null, null);

            newClient().updateDatasetSettings("ds-1", graphOn);

            JsonNode body = mapper.readTree(lastBody.get());
            JsonNode graphrag = body.get("parser_config").get("graphrag");
            assertTrue(graphrag.get("use_graphrag").asBoolean());
            assertEquals("light", graphrag.get("method").asText(),
                    "Wave B：开启图谱时 method=light（引擎唯一接受的构图方法）");
            // raptor 子对象同体共存（P1c 实测 raptor + graphrag 可同时 true）
            assertTrue(body.get("parser_config").has("raptor"));
            assertTrue(body.get("parser_config").get("raptor").get("use_raptor").asBoolean());
        }
    }

    @Nested
    @DisplayName("B1：updateDocumentEnabled 真实启停语义")
    class UpdateDocumentEnabled {

        @Test
        @DisplayName("启用 → PUT + body enabled=1（整数，不是布尔）")
        void enableSendsIntegerOne() throws Exception {
            newClient().updateDocumentEnabled("ds-1", "doc-1", true);

            assertEquals("PUT", lastMethod.get());
            assertEquals("/api/v1/datasets/ds-1/documents/doc-1", lastPath.get());
            JsonNode body = mapper.readTree(lastBody.get());
            assertTrue(body.get("enabled").isInt(),
                    "RAGFlow 该版本 enabled 必须为整数，布尔会被拒 code:102");
            assertEquals(1, body.get("enabled").asInt());
        }

        @Test
        @DisplayName("停用 → PUT + body enabled=0（整数）")
        void disableSendsIntegerZero() throws Exception {
            newClient().updateDocumentEnabled("ds-1", "doc-1", false);

            assertEquals("PUT", lastMethod.get());
            assertEquals("/api/v1/datasets/ds-1/documents/doc-1", lastPath.get());
            JsonNode body = mapper.readTree(lastBody.get());
            assertTrue(body.get("enabled").isInt());
            assertEquals(0, body.get("enabled").asInt());
        }

        @Test
        @DisplayName("失败响应 → BusinessException")
        void failureThrowsBusinessException() {
            RagflowClient client = newClient();

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> client.updateDocumentEnabled("ds-1", "doc-fail", true));

            assertTrue(ex.getMessage().contains("更新文档启用状态失败"),
                    "实际：" + ex.getMessage());
        }
    }

    @Nested
    @DisplayName("B3：retrieve 请求体为顶层扁平字段，响应 data 为对象")
    class RetrieveBodyFormat {

        @Test
        @DisplayName("请求体：顶层扁平字段，无嵌套 retrieval_setting，无 top_k")
        void bodyIsFlatWithoutRetrievalSetting() throws Exception {
            RetrieveQuery query = new RetrieveQuery(
                    "季度报表", List.of(1L), 10, 0.2, "hybrid", 0.3, false, null, null, null);

            newClient().retrieve(query, List.of("ds-1"), List.of());

            JsonNode body = mapper.readTree(lastBody.get());
            assertEquals("季度报表", body.get("question").asText());
            assertEquals("ds-1", body.get("dataset_ids").get(0).asText());
            // B3-①：page_size 落 effectiveTopK；top_k 不再下发（那是候选数，非输出条数）
            assertEquals(10, body.get("page_size").asInt());
            assertFalse(body.has("top_k"),
                    "top_k 是向量召回候选数（默认 1024），MIS topK 映射到 page_size，不应再下发 top_k");
            // B3-①：该实例静默忽略嵌套 retrieval_setting，禁止下发
            assertFalse(body.has("retrieval_setting"),
                    "该实例忽略 retrieval_setting 内一切字段，下发等于没传（B3 实测）");
            // B3-①：search_method 顶层也不生效（实测被忽略），禁止下发
            assertFalse(body.has("search_method"),
                    "该实例顶层 search_method 不生效，禁止下发（B3 实测）");
            assertEquals(0.2, body.get("similarity_threshold").asDouble(), 0.0001);
            // B3-②：hybrid 必须发 keyword=false（旧实现发 true → 全文候选 → 无全文命中即 0 条）
            assertFalse(body.get("keyword").asBoolean(),
                    "hybrid 发 keyword=true 会走全文候选，query 无全文命中即空结果（B3 实测根因）");
            assertEquals(0.3, body.get("vector_similarity_weight").asDouble(), 0.0001);
            assertFalse(body.has("rerank_id"), "rerank=false 时 rerank_id 连键都不应出现");
        }

        @Test
        @DisplayName("vector → keyword=false + weight=1.0；keyword → keyword=true + weight=0.0")
        void methodToKeywordWeightMapping() throws Exception {
            // vector
            newClient().retrieve(new RetrieveQuery(
                    "q", List.of(1L), 5, 0.2, "vector", 0.4, false, null, null, null), List.of("ds-1"), List.of());
            JsonNode vectorBody = mapper.readTree(lastBody.get());
            assertFalse(vectorBody.get("keyword").asBoolean());
            assertEquals(1.0, vectorBody.get("vector_similarity_weight").asDouble(), 0.0001);

            // keyword
            newClient().retrieve(new RetrieveQuery(
                    "q", List.of(1L), 5, 0.2, "keyword", 0.4, false, null, null, null), List.of("ds-1"), List.of());
            JsonNode keywordBody = mapper.readTree(lastBody.get());
            assertTrue(keywordBody.get("keyword").asBoolean());
            assertEquals(0.0, keywordBody.get("vector_similarity_weight").asDouble(), 0.0001);
        }

        @Test
        @DisplayName("rerank=true 且模型 ID 非空 → 顶层下发 rerank_id")
        void rerankIdSentWhenEnabled() throws Exception {
            newClient().retrieve(new RetrieveQuery(
                    "q", List.of(1L), 5, 0.2, "hybrid", 0.3, true, "qwen3-rerank@Tongyi-Qianwen@Tongyi-Qianwen", null, null),
                    List.of("ds-1"), List.of());

            JsonNode body = mapper.readTree(lastBody.get());
            assertEquals("qwen3-rerank@Tongyi-Qianwen@Tongyi-Qianwen", body.get("rerank_id").asText(),
                    "rerank_id 必须在顶层（该实例 retrieval_setting 内的 rerank_id 被忽略）");
        }

        @Test
        @DisplayName("响应 data 为对象：chunks 可反序列化，content/similarity/document_keyword 映射正确")
        void responseDataObjectParsed() {
            KbLibraryRepository libRepo = mock(KbLibraryRepository.class);
            KbDocumentRepository docRepo = mock(KbDocumentRepository.class);
            KbLibrary lib = new KbLibrary();
            lib.setId(1L);
            lib.setEngineLibraryRef("ds-1");
            when(libRepo.findById(1L)).thenReturn(Optional.of(lib));
            // 三个 chunk 的文档均无本地记录 → doc==null 维持透传，避免本地 enabled 过滤干扰字段断言
            when(docRepo.findByEngineDocumentRef("doc-disabled")).thenReturn(Optional.empty());
            when(docRepo.findByEngineDocumentRef("doc-enabled")).thenReturn(Optional.empty());
            when(docRepo.findByEngineDocumentRef("doc-unknown")).thenReturn(Optional.empty());

            RagflowAdapter a = newAdapter(libRepo, docRepo);
            List<ChunkHit> hits = a.retrieve(new RetrieveQuery("季度报表", List.of(1L), 10, 0.2));

            assertEquals(3, hits.size());
            ChunkHit first = hits.get(0);
            assertEquals("t1", first.chunkText(),
                    "chunk 正文来自响应 content 字段（旧 DTO 读 text → 全 null）");
            assertEquals(0.9, first.score(), 0.0001,
                    "chunk 分数来自响应 similarity 字段（旧 DTO 读 score → 全 null）");
            assertEquals("a.pdf", first.docTitle(),
                    "chunk 文档名来自响应 document_keyword 字段（旧 DTO 读 document_name → 全 null）");
        }

        @Test
        @DisplayName("RfRetrievalData 对象反序列化：chunks/doc_aggs/total 齐全，doc_aggs 字段名正确")
        void retrievalDataObjectDeserializedWithAggsAndTotal() throws Exception {
            String json = "{\"chunks\":[{\"document_id\":\"d1\",\"document_keyword\":\"a.pdf\","
                    + "\"content\":\"正文\",\"similarity\":0.91,\"positions\":[[3,1,2,3,4]]}],"
                    + "\"doc_aggs\":[{\"doc_id\":\"d1\",\"doc_name\":\"a.pdf\",\"count\":2}],\"total\":7}";
            RfRetrievalData data = mapper.readValue(json, RfRetrievalData.class);

            assertEquals(1, data.chunks().size());
            assertEquals(Integer.valueOf(7), data.total(),
                    "total 是分页前命中总数，必须正确反序列化");
            assertEquals(1, data.docAggs().size());
            assertEquals("a.pdf", data.docAggs().get(0).docName(),
                    "doc_aggs 单项字段是 doc_id/doc_name/count（不是 id/name）");
            assertEquals(Integer.valueOf(2), data.docAggs().get(0).count());
        }

        @Test
        @DisplayName("firstPage 从 positions[0][0] 解析：有值取页码，positions 空/缺失/不规则返回 null")
        void firstPageParsedFromPositions() throws Exception {
            RfChunk withPos = mapper.readValue(
                    "{\"document_id\":\"d1\",\"document_keyword\":\"a.pdf\",\"content\":\"t\","
                            + "\"similarity\":0.9,\"positions\":[[3,1,2,3,4],[5,1,2,3,4]]}",
                    RfChunk.class);
            assertEquals(Integer.valueOf(3), withPos.firstPage(),
                    "positions 每行首元素即页码（1-based），firstPage 取首行首元素");

            RfChunk noPos = mapper.readValue(
                    "{\"document_id\":\"d1\",\"document_keyword\":\"a.pdf\",\"content\":\"t\","
                            + "\"similarity\":0.9}",
                    RfChunk.class);
            assertEquals(null, noPos.firstPage(), "positions 缺失 → null（防御式）");

            RfChunk emptyPos = mapper.readValue(
                    "{\"document_id\":\"d1\",\"document_keyword\":\"a.pdf\",\"content\":\"t\","
                            + "\"similarity\":0.9,\"positions\":[]}",
                    RfChunk.class);
            assertEquals(null, emptyPos.firstPage(), "positions 空数组 → null（防御式）");

            RfChunk ragged = mapper.readValue(
                    "{\"document_id\":\"d1\",\"document_keyword\":\"a.pdf\",\"content\":\"t\","
                            + "\"similarity\":0.9,\"positions\":[[],[1,2,3]]}",
                    RfChunk.class);
            assertEquals(null, ragged.firstPage(), "positions 首行空列表 → null（防御式）");
        }
    }

    @Nested
    @DisplayName("B1 链路闭环：适配器 setDocumentEnabled / retrieve")
    class AdapterChain {

        @Test
        @DisplayName("setDocumentEnabled(false) 发 PUT 启停（绝不是 DELETE 删除）")
        void setDocumentEnabledSendsPutNotDelete() {
            RagflowAdapter adapter = newAdapter(
                    mock(KbLibraryRepository.class), mock(KbDocumentRepository.class));

            adapter.setDocumentEnabled(
                    new EngineLibraryRef("ragflow", "ds-1"),
                    new EngineDocumentRef("ragflow", "doc-1"),
                    false);

            assertEquals("PUT", lastMethod.get(),
                    "旧实现这里会发 DELETE（deleteDocument 不可逆删除）—— B1 修复必须改成 PUT 启停");
            assertEquals("/api/v1/datasets/ds-1/documents/doc-1", lastPath.get());
        }

        @Test
        @DisplayName("setDocumentEnabled(true) 发 PUT + enabled=1")
        void setDocumentEnabledTrueSendsPutEnable() throws Exception {
            RagflowAdapter adapter = newAdapter(
                    mock(KbLibraryRepository.class), mock(KbDocumentRepository.class));

            adapter.setDocumentEnabled(
                    new EngineLibraryRef("ragflow", "ds-1"),
                    new EngineDocumentRef("ragflow", "doc-1"),
                    true);

            assertEquals("PUT", lastMethod.get());
            JsonNode body = mapper.readTree(lastBody.get());
            assertEquals(1, body.get("enabled").asInt());
        }

        @Test
        @DisplayName("retrieve：本地 enabled≠1 的 chunk 被丢弃；enabled=1 保留；doc==null 维持旧行为透传")
        void retrieveDropsLocallyDisabledChunks() throws Exception {
            KbLibraryRepository libRepo = mock(KbLibraryRepository.class);
            KbDocumentRepository docRepo = mock(KbDocumentRepository.class);

            KbLibrary lib = new KbLibrary();
            lib.setId(1L);
            lib.setEngineType("ragflow");
            lib.setEngineLibraryRef("ds-1");
            when(libRepo.findById(1L)).thenReturn(Optional.of(lib));

            KbDocument disabled = new KbDocument();
            disabled.setId(11L);
            disabled.setLibraryId(1L);
            disabled.setEnabled(0);
            KbDocument enabled = new KbDocument();
            enabled.setId(12L);
            enabled.setLibraryId(1L);
            enabled.setEnabled(1);
            when(docRepo.findByEngineDocumentRef("doc-disabled")).thenReturn(Optional.of(disabled));
            when(docRepo.findByEngineDocumentRef("doc-enabled")).thenReturn(Optional.of(enabled));
            when(docRepo.findByEngineDocumentRef("doc-unknown")).thenReturn(Optional.empty());

            RagflowAdapter adapter = newAdapter(libRepo, docRepo);
            RetrieveQuery query = new RetrieveQuery("季度报表", List.of(1L), 10, 0.2);

            List<ChunkHit> hits = adapter.retrieve(query);

            assertEquals(2, hits.size(),
                    "3 个 chunk 中停用文档必须被丢弃，剩 enabled=1 与 doc==null 两个");
            assertFalse(hits.stream().anyMatch(h -> Long.valueOf(11L).equals(h.documentId())),
                    "本地 enabled=0 的文档绝不允许进入检索结果");
            assertTrue(hits.stream().anyMatch(h -> Long.valueOf(12L).equals(h.documentId())),
                    "本地 enabled=1 的文档必须保留");
            assertTrue(hits.stream().anyMatch(h -> h.documentId() == null),
                    "doc==null 时无法判断本地状态，维持旧行为透传（不额外丢弃）");

            // 入参翻译：MIS libraryId → 原生 dataset_id
            JsonNode body = mapper.readTree(lastBody.get());
            assertEquals("ds-1", body.get("dataset_ids").get(0).asText());
        }

        @Test
        @DisplayName("retrieve：library 无引擎映射 → 返回空（不发检索请求）")
        void retrieveSkipsWhenNoEngineRef() {
            KbLibraryRepository libRepo = mock(KbLibraryRepository.class);
            KbDocumentRepository docRepo = mock(KbDocumentRepository.class);
            KbLibrary lib = new KbLibrary();
            lib.setId(1L);
            lib.setEngineLibraryRef(null);
            when(libRepo.findById(1L)).thenReturn(Optional.of(lib));

            RagflowAdapter adapter = newAdapter(libRepo, docRepo);
            RetrieveQuery query = new RetrieveQuery("季度报表", List.of(1L), 10, 0.2);

            List<ChunkHit> hits = adapter.retrieve(query);

            assertTrue(hits.isEmpty());
            assertEquals(0, requestCount.get());
        }
    }
}
