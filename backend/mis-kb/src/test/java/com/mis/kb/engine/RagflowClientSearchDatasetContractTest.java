package com.mis.kb.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.kb.domain.entity.KbDocument;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.ChunkHit;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.model.RetrieveQuery;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
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
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * {@code /datasets/{id}/search}（单库图谱增强检索）契约测试（Wave B GraphRAG PoC，T04）。
 *
 * <p><b>R2 风险防线（设计 §4.2 / §10-5 共享知识）：</b>「{@code /api/v1/retrieval} 对
 * {@code use_kg} 静默忽略（已实测）」是 Wave B 最高风险——若代码回归到旧端点，表现为
 * 「code:0 但无增强」的静默假象，管理员看不出差异，金标对比直接失效。因此用 JDK
 * {@link HttpServer} 起本地假 RAGFlow，让<b>真实</b> {@link RestClient} 打真实 HTTP，
 * 对「线上字节」做硬断言（与 {@code RagflowClientHttpTest} 同构）。
 *
 * <p>锁定契约（T00 G5/G6/G7 实测 + 设计 §2.4）：
 * <ol>
 *   <li><b>端点</b>：{@code useKnowledgeGraph=true} → {@code POST /api/v1/datasets/{id}/search}
 *       （路径参数单库，请求体<b>不</b>带 {@code dataset_ids}）；</li>
 *   <li><b>请求体</b>：{@code use_kg:true} 必含；{@code doc_ids} 非空才下发（空 = 全量）；</li>
 *   <li><b>重排字段</b>：/datasets/search 用 {@code rerank_mdl}（与 /retrieval 的 rerank_id 同值）；</li>
 *   <li><b>响应映射</b>：{@code content_with_weight} 剥离标记 → chunkText；{@code docnm_kwd} →
 *       docTitle；{@code doc_id}/{@code kb_id} 反查 MIS id；{@code similarity} → score；</li>
 *   <li><b>适配器分流</b>：{@code effectiveUseKnowledgeGraph()==true} → /search；
 *       false → /retrieval（零回归）。</li>
 * </ol>
 */
class RagflowClientSearchDatasetContractTest {

    private static final String API_KEY = "test-api-key";
    private static final String DATASET_ID = "ds-graph-1";

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
            lastBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));

            String response;
            String path = exchange.getRequestURI().getPath();
            if (path.equals("/api/v1/datasets/" + DATASET_ID + "/search")) {
                // G7 实测：data 是对象 {chunks, total}；chunk 字段 content_with_weight/docnm_kwd/
                // doc_id/kb_id/similarity/chunk_id（与 /retrieval 完全不同）
                response = "{\"code\":0,\"message\":\"ok\",\"data\":{\"chunks\":["
                        + "{\"chunk_id\":\"c1\",\"content_with_weight\":\"<weight 0.9>图谱命中正文</weight>\","
                        + "\"docnm_kwd\":\"员工手册.pdf\",\"doc_id\":\"doc-1\",\"kb_id\":\"" + DATASET_ID
                        + "\",\"similarity\":0.88}"
                        + "],\"total\":1}}";
            } else if (path.equals("/api/v1/retrieval")) {
                response = "{\"code\":0,\"message\":\"ok\",\"data\":{\"chunks\":[],\"doc_aggs\":[],\"total\":0}}";
            } else {
                response = "{\"code\":404,\"message\":\"not found\",\"data\":null}";
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
        props.setRerankModelId("qwen3-rerank@Tongyi-Qianwen@Tongyi-Qianwen");
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    private RagflowClient newClient() {
        return new RagflowClient(RestClient.builder(), baseUrl, API_KEY);
    }

    private RagflowAdapter newAdapter(KbLibraryRepository libRepo, KbDocumentRepository docRepo) {
        return new RagflowAdapter(props, RestClient.builder(), libRepo, docRepo);
    }

    /** 构造开启图谱增强的检索查询（11 参 canonical，useKnowledgeGraph=true）。 */
    private static RetrieveQuery graphQuery() {
        return new RetrieveQuery(
                "五险一金怎么交", List.of(1L), 5, 0.2, "hybrid", 0.3, false, null, null,
                List.of(), true);
    }

    // ------------------------------------------------------------ 契约 1：端点与请求体

    @Test
    @DisplayName("★ useKnowledgeGraph=true → 路径必须是 /datasets/{id}/search（禁 /api/v1/retrieval）")
    void searchDatasetHitsSearchEndpoint() {
        newClient().searchDataset(DATASET_ID, graphQuery(), List.of());

        assertEquals("POST", lastMethod.get());
        assertEquals("/api/v1/datasets/" + DATASET_ID + "/search", lastPath.get(),
                "R2 红线：图谱增强必须走 /datasets/{id}/search，/api/v1/retrieval 会静默忽略 use_kg");
        assertEquals("Bearer " + API_KEY, lastAuth.get());
    }

    @Test
    @DisplayName("请求体含 use_kg=true + size + similarity_threshold + keyword，且不含 dataset_ids")
    void searchDatasetBodyMapsParams() throws Exception {
        newClient().searchDataset(DATASET_ID, graphQuery(), List.of("doc-1"));

        JsonNode body = mapper.readTree(lastBody.get());
        assertEquals("五险一金怎么交", body.get("question").asText());
        assertTrue(body.get("use_kg").asBoolean(),
                "use_kg:true 必须下发——这是图谱增强的检索键（G5）");
        assertEquals(5, body.get("size").asInt(),
                "effectiveTopK → size（/datasets/search 的返回条数字段）");
        assertEquals(0.2, body.get("similarity_threshold").asDouble(), 0.0001);
        assertFalse(body.get("keyword").asBoolean(),
                "hybrid → keyword=false（同现状映射）");
        assertEquals(0.3, body.get("vector_similarity_weight").asDouble(), 0.0001);
        assertFalse(body.has("dataset_ids"),
                "单库走路径参数，请求体不带 dataset_ids（避免多库 embedding 一致性限制，G8）");
    }

    @Test
    @DisplayName("doc_ids 非空才下发；空 = 不下发键（R5 同款：空 = 全量）")
    void docIdsOnlyWhenPresent() throws Exception {
        // 非空 → 下发 doc_ids
        newClient().searchDataset(DATASET_ID, graphQuery(), List.of("doc-1", "doc-2"));
        JsonNode withDocIds = mapper.readTree(lastBody.get());
        assertEquals("doc-1", withDocIds.get("doc_ids").get(0).asText());
        assertEquals("doc-2", withDocIds.get("doc_ids").get(1).asText());

        // 空 → 不下发 doc_ids 键（R5：空 = 全量）
        newClient().searchDataset(DATASET_ID, graphQuery(), List.of());
        JsonNode noDocIds = mapper.readTree(lastBody.get());
        assertFalse(noDocIds.has("doc_ids"),
                "空 doc_ids 不下发键——下发空数组会被引擎当成「空过滤」，与「全量」语义冲突");
    }

    @Test
    @DisplayName("rerank=true 且全局模型非空 → /datasets/search 用 rerank_mdl（与 /retrieval 的 rerank_id 同值）")
    void rerankMdlSentWhenEnabled() throws Exception {
        RetrieveQuery query = new RetrieveQuery(
                "q", List.of(1L), 5, 0.2, "hybrid", 0.3, true,
                "qwen3-rerank@Tongyi-Qianwen@Tongyi-Qianwen", null, List.of(), true);
        newClient().searchDataset(DATASET_ID, query, List.of());

        JsonNode body = mapper.readTree(lastBody.get());
        assertEquals("qwen3-rerank@Tongyi-Qianwen@Tongyi-Qianwen", body.get("rerank_mdl").asText(),
                "/datasets/search 的重排字段是 rerank_mdl（不是 rerank_id）");
    }

    // ------------------------------------------------------------ 契约 2：响应映射

    @Test
    @DisplayName("响应映射：content_with_weight 剥离标记 / docnm_kwd / doc_id+kb_id 反查 / similarity")
    void searchResponseMappedToChunkHit() {
        KbLibraryRepository libRepo = mock(KbLibraryRepository.class);
        KbDocumentRepository docRepo = mock(KbDocumentRepository.class);
        KbLibrary lib = new KbLibrary();
        lib.setId(1L);
        lib.setEngineLibraryRef(DATASET_ID);
        when(libRepo.findById(1L)).thenReturn(Optional.of(lib));
        // kb_id 反查 MIS 库 id
        when(libRepo.findByEngineLibraryRef(DATASET_ID)).thenReturn(Optional.of(lib));
        // doc_id 反查 MIS 文档（enabled=1，放行）
        KbDocument doc = new KbDocument();
        doc.setId(100L);
        doc.setLibraryId(1L);
        doc.setEnabled(1);
        when(docRepo.findByEngineDocumentRef("doc-1")).thenReturn(Optional.of(doc));

        RagflowAdapter a = newAdapter(libRepo, docRepo);
        List<ChunkHit> hits = a.retrieve(graphQuery());

        assertEquals(1, hits.size());
        ChunkHit hit = hits.get(0);
        assertEquals("图谱命中正文", hit.chunkText(),
                "chunkText 必须剥离 <weight> 标记（R3）");
        assertEquals("员工手册.pdf", hit.docTitle(),
                "docTitle 来自 docnm_kwd（引擎已给文档名）");
        assertEquals(100L, hit.documentId(),
                "doc_id 反查 MIS KbDocument.id");
        assertEquals(1L, hit.libraryId(),
                "kb_id 反查 MIS KbLibrary.id");
        assertEquals(0.88, hit.score(), 0.0001,
                "score 来自 similarity");
    }

    @Test
    @DisplayName("反查不到本地记录 → documentId/libraryId 为 null，绝不透传原生 id")
    void missingLocalRecordsYieldNullIds() {
        KbLibraryRepository libRepo = mock(KbLibraryRepository.class);
        KbDocumentRepository docRepo = mock(KbDocumentRepository.class);
        KbLibrary lib = new KbLibrary();
        lib.setId(1L);
        lib.setEngineLibraryRef(DATASET_ID);
        when(libRepo.findById(1L)).thenReturn(Optional.of(lib));
        when(libRepo.findByEngineLibraryRef(DATASET_ID)).thenReturn(Optional.empty());
        when(docRepo.findByEngineDocumentRef("doc-1")).thenReturn(Optional.empty());

        RagflowAdapter a = newAdapter(libRepo, docRepo);
        List<ChunkHit> hits = a.retrieve(graphQuery());

        assertEquals(1, hits.size());
        assertFalse(hits.get(0).documentId() != null || hits.get(0).libraryId() != null,
                "本地无记录时 MIS id 必须为 null（口径与经典检索一致）");
        assertEquals("员工手册.pdf", hits.get(0).docTitle(),
                "docTitle 来自引擎 docnm_kwd，反查失败仍可展示");
    }

    // ------------------------------------------------------------ 契约 3：适配器分流

    @Test
    @DisplayName("适配器分流：useKnowledgeGraph=true → /search；false → /retrieval（零回归）")
    void adapterBranchesByGraphFlag() {
        KbLibraryRepository libRepo = mock(KbLibraryRepository.class);
        KbDocumentRepository docRepo = mock(KbDocumentRepository.class);
        KbLibrary lib = new KbLibrary();
        lib.setId(1L);
        lib.setEngineLibraryRef(DATASET_ID);
        when(libRepo.findById(1L)).thenReturn(Optional.of(lib));
        when(libRepo.findByEngineLibraryRef(DATASET_ID)).thenReturn(Optional.of(lib));
        when(docRepo.findByEngineDocumentRef("doc-1")).thenReturn(Optional.empty());

        RagflowAdapter a = newAdapter(libRepo, docRepo);

        // 图谱增强开 → /datasets/{id}/search
        a.retrieve(graphQuery());
        assertEquals("/api/v1/datasets/" + DATASET_ID + "/search", lastPath.get());

        // 图谱增强关（经典检索）→ /api/v1/retrieval（零回归）
        requestCount.set(0);
        a.retrieve(new RetrieveQuery("五险一金怎么交", List.of(1L), 5, 0.2));
        assertEquals("/api/v1/retrieval", lastPath.get());
    }
}
