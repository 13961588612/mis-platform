package com.mis.kb.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.kb.domain.model.DocumentChunkConfig;
import com.mis.kb.domain.model.DocumentUploadInput;
import com.mis.kb.domain.model.EngineDocumentRef;
import com.mis.kb.domain.model.EngineLibraryRef;
import com.mis.kb.domain.model.EngineModelPool;
import com.mis.kb.domain.repository.KbDocumentRepository;
import com.mis.kb.domain.repository.KbLibraryRepository;
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
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

/**
 * {@code RagflowAdapter} 两段式上传 / {@code RagflowClient.listModels} /
 * {@code updateDocumentConfig} 的 HTTP 级补测（T4，2026-08-12）。
 *
 * <p>背景：T02/T04（kb_settings_model_chunk）实现的模型池探测、两步式上传与文档级
 * 切片下发此前只有 {@code EngineModelPoolServiceTest}（5 例，mock 端口）+ 读码 +
 * T00 curl 实锤，<b>没有直接打到线上字节的单测</b>。本测试与 {@code RagflowClientHttpTest}
 * 同构：JDK {@link HttpServer} 起本地假 RAGFlow，让<b>真实</b> {@link RestClient}
 * 打真实请求，按请求顺序断言 method / path / body —— 拿到的就是 RAGFlow 侧看到的字节。
 *
 * <p>钉死四条契约（对应 T00 实测）：
 * <ol>
 *   <li><b>无 chunkConfig 时不发多余 PUT</b>——上传只走 POST /documents + POST /chunks；</li>
 *   <li><b>全限定 id 拼接</b>——{@code listModels} 后模型 id 组装为
 *       {@code name@instance_name@provider_name}（裸名被拒 code:101/100）；</li>
 *   <li><b>{@code updateDocumentConfig} 的 PUT body 白名单</b>——只有
 *       {@code chunk_method} + {@code parser_config{chunk_token_num, delimiter}}
 *       （该实例 pydantic 严格校验 extra=forbid，多余键整单拒收）；</li>
 *   <li><b>两步式</b>——PUT 更新文档配置后必须显式 POST /chunks 才触发重解析
 *       （PUT 本身不会自动重解析，T00 P5）。</li>
 * </ol>
 */
class RagflowUploadAndModelsHttpTest {

    private static final String API_KEY = "test-api-key";

    private static final String MODELS_BODY = "{\"code\":0,\"message\":\"ok\",\"data\":["
            + "{\"name\":\"text-embedding-v3\",\"model_type\":[\"embedding\"],"
            + "\"provider_name\":\"Tongyi-Qianwen\",\"instance_name\":\"Tongyi-Qianwen\","
            + "\"provider_id\":\"p1\",\"instance_id\":\"i1\"},"
            + "{\"name\":\"qwen3-rerank\",\"model_type\":[\"rerank\"],"
            + "\"provider_name\":\"Tongyi-Qianwen\",\"instance_name\":\"Tongyi-Qianwen\","
            + "\"provider_id\":\"p2\",\"instance_id\":\"i2\"}"
            + "]}";

    private final ObjectMapper mapper = new ObjectMapper();
    private HttpServer server;

    /** 按到达顺序记录 (method, path, body)，供两步式顺序断言。 */
    private final List<RequestRecord> requests = new ArrayList<>();
    private final AtomicInteger requestCount = new AtomicInteger();

    private String baseUrl;

    private record RequestRecord(String method, String path, String body) {
    }

    @BeforeEach
    void setUp() throws IOException {
        requests.clear();
        requestCount.set(0);

        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            requestCount.incrementAndGet();
            String method = exchange.getRequestMethod();
            String path = exchange.getRequestURI().getPath();
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            requests.add(new RequestRecord(method, path, body));

            String response;
            if ("GET".equals(method) && path.equals("/api/v1/models")) {
                response = MODELS_BODY;
            } else if ("POST".equals(method) && path.matches(".*/documents")) {
                // 上传返回列表；T00 实测 data 为数组
                response = "{\"code\":0,\"message\":\"ok\",\"data\":[{\"id\":\"doc-1\",\"name\":\"x.pdf\"}]}";
            } else {
                response = "{\"code\":0,\"message\":\"ok\",\"data\":{\"id\":\"doc-1\",\"name\":\"x.pdf\"}}";
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
    }

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    private RagflowProperties props() {
        RagflowProperties props = new RagflowProperties();
        props.setBaseUrl(baseUrl);
        props.setApiKey(API_KEY);
        return props;
    }

    private RagflowClient newClient() {
        return new RagflowClient(RestClient.builder(), baseUrl, API_KEY);
    }

    private RagflowAdapter newAdapter() {
        return new RagflowAdapter(
                props(), RestClient.builder(),
                mock(KbLibraryRepository.class), mock(KbDocumentRepository.class));
    }

    private static DocumentUploadInput upload(String filename, DocumentChunkConfig chunkConfig) {
        return new DocumentUploadInput(
                filename, "application/pdf", 3, new byte[]{1, 2, 3}, chunkConfig);
    }

    @Nested
    @DisplayName("T4-①：无 chunkConfig 上传不发多余 PUT")
    class UploadWithoutChunkConfig {

        @Test
        @DisplayName("不带文件级切片参数 → 只 POST /documents + POST /chunks，绝无 PUT")
        void uploadWithoutConfigSendsNoPut() {
            RagflowAdapter adapter = newAdapter();

            adapter.uploadDocument(
                    new EngineLibraryRef("ragflow", "ds-1"),
                    upload("a.pdf", null));

            assertEquals(2, requests.size(),
                    () -> "应当只有上传与触发解析两次请求，实际：" + requests);
            assertEquals("POST", requests.get(0).method());
            assertEquals("/api/v1/datasets/ds-1/documents", requests.get(0).path());
            assertEquals("POST", requests.get(1).method());
            assertEquals("/api/v1/datasets/ds-1/chunks", requests.get(1).path());
            assertFalse(requests.stream().anyMatch(r -> "PUT".equals(r.method())),
                    "无 chunkConfig 时绝不允许多发 PUT 更新文档配置（行为与旧版一致）");
        }

        @Test
        @DisplayName("客户端直调 uploadDocument 同样只发 POST /documents")
        void clientUploadSendsOnlyPost() {
            RagflowClient client = newClient();

            String docId = client.uploadDocument("ds-1", upload("a.pdf", null));

            assertEquals("doc-1", docId);
            assertEquals(1, requests.size());
            assertEquals("POST", requests.get(0).method());
            assertEquals("/api/v1/datasets/ds-1/documents", requests.get(0).path());
        }
    }

    @Nested
    @DisplayName("T4-④：带文件级参数 → PUT 更新配置后显式 POST /chunks 两步式")
    class TwoStepUpload {

        @Test
        @DisplayName("上传 + 文件级切片 → POST /documents → PUT /documents/{id} → POST /chunks（顺序固定）")
        void uploadWithConfigFollowsTwoStepSequence() {
            RagflowAdapter adapter = newAdapter();
            DocumentChunkConfig config = new DocumentChunkConfig("naive", 512, "###");

            adapter.uploadDocument(
                    new EngineLibraryRef("ragflow", "ds-1"),
                    upload("a.pdf", config));

            assertEquals(3, requests.size(),
                    () -> "两步式：上传 + PUT 配置 + 触发解析，实际：" + requests);
            assertEquals("POST", requests.get(0).method());
            assertEquals("/api/v1/datasets/ds-1/documents", requests.get(0).path());
            assertEquals("PUT", requests.get(1).method());
            assertEquals("/api/v1/datasets/ds-1/documents/doc-1", requests.get(1).path(),
                    "PUT 落在刚上传返回的 doc id 上（T00 P3 路径）");
            assertEquals("POST", requests.get(2).method());
            assertEquals("/api/v1/datasets/ds-1/chunks", requests.get(2).path(),
                    "PUT 后必须显式 POST /chunks 才触发重解析（T00 P5，两步式）");
        }

        @Test
        @DisplayName("updateDocumentChunkConfig（适配层）同样先 PUT 再 POST /chunks")
        void updateChunkConfigSendsPutThenParse() {
            RagflowAdapter adapter = newAdapter();

            adapter.updateDocumentChunkConfig(
                    new EngineLibraryRef("ragflow", "ds-1"),
                    new EngineDocumentRef("ragflow", "doc-1"),
                    new DocumentChunkConfig("qa", 256, "|"));

            assertEquals(2, requests.size());
            assertEquals("PUT", requests.get(0).method());
            assertEquals("/api/v1/datasets/ds-1/documents/doc-1", requests.get(0).path());
            assertEquals("POST", requests.get(1).method());
            assertEquals("/api/v1/datasets/ds-1/chunks", requests.get(1).path());
        }
    }

    @Nested
    @DisplayName("T4-③：updateDocumentConfig PUT body 白名单（extra=forbid）")
    class UpdateDocumentConfigBodyWhitelist {

        @Test
        @DisplayName("只下发 chunk_method + parser_config{chunk_token_num, delimiter}，无任何多余键")
        void bodyContainsOnlyWhitelistedKeys() throws Exception {
            RagflowClient client = newClient();

            client.updateDocumentConfig("ds-1", "doc-1",
                    new DocumentChunkConfig("naive", 512, "###"));

            assertEquals(1, requests.size());
            assertEquals("PUT", requests.get(0).method());
            JsonNode body = mapper.readTree(requests.get(0).body());
            assertEquals("naive", body.get("chunk_method").asText());
            assertEquals(512, body.get("parser_config").get("chunk_token_num").asInt());
            assertEquals("###", body.get("parser_config").get("delimiter").asText());
            assertEquals(2, body.size(),
                    () -> "顶层只允许 chunk_method + parser_config（extra=forbid，多键整单拒收），实际：" + body);
            assertEquals(2, body.get("parser_config").size(),
                    () -> "parser_config 只允许 chunk_token_num + delimiter，实际：" + body.get("parser_config"));
        }

        @Test
        @DisplayName("全 null 配置 → 不发请求（沿用「未指定继承库级」）")
        void nullConfigSkipsRequest() {
            RagflowClient client = newClient();

            client.updateDocumentConfig("ds-1", "doc-1", null);

            assertEquals(0, requestCount.get(), "无有效字段时不应打 RAGFlow");
        }

        @Test
        @DisplayName("仅 chunkMethod 非空 → body 只有 chunk_method，无 parser_config 空壳")
        void partialConfigOmitsEmptyParserConfig() throws Exception {
            RagflowClient client = newClient();

            client.updateDocumentConfig("ds-1", "doc-1", new DocumentChunkConfig("naive", null, null));

            JsonNode body = mapper.readTree(requests.get(0).body());
            assertEquals(1, body.size());
            assertEquals("naive", body.get("chunk_method").asText());
            assertFalse(body.has("parser_config"), "parser_config 无有效字段时连键都不该出现");
        }
    }

    @Nested
    @DisplayName("T4-②：listModels 全限定 id 拼接")
    class ListModelsFullyQualifiedId {

        @Test
        @DisplayName("probeModelPool → embedding/rerank 模型 id 均为 name@instance@provider 全限定")
        void probeModelPoolBuildsFullyQualifiedIds() {
            RagflowAdapter adapter = newAdapter();

            EngineModelPool pool = adapter.probeModelPool();

            assertTrue(pool.available());
            assertEquals(1, pool.embedding().size());
            assertEquals(1, pool.rerank().size());
            assertEquals("text-embedding-v3@Tongyi-Qianwen@Tongyi-Qianwen",
                    pool.embedding().get(0).id(),
                    "embedding 模型 id 必须全限定拼接（T00 P1：裸名被拒 code:101）");
            assertEquals("qwen3-rerank@Tongyi-Qianwen@Tongyi-Qianwen",
                    pool.rerank().get(0).id(),
                    "rerank 模型 id 必须全限定拼接（T00 P1：裸名被拒 code:100）");
            assertEquals("Tongyi-Qianwen", pool.embedding().get(0).provider());
        }

        @Test
        @DisplayName("客户端直调 listModels 原样返回原生列表（不加工字段）")
        void clientListModelsReturnsRawList() {
            RagflowClient client = newClient();

            var models = client.listModels();

            assertEquals(2, models.size());
            assertEquals("text-embedding-v3", models.get(0).name());
            assertTrue(models.get(0).isEmbedding());
            assertTrue(models.get(1).isRerank());
            assertEquals("Tongyi-Qianwen", models.get(0).instanceName());
        }
    }
}
