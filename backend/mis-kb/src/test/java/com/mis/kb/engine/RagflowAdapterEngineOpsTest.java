package com.mis.kb.engine;

import com.mis.kb.domain.model.CreateLibraryCmd;
import com.mis.kb.domain.model.EngineCapabilities;
import com.mis.kb.domain.model.EngineLibraryBrief;
import com.mis.kb.domain.model.EngineLibraryRef;
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
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

/**
 * RagflowAdapter 引擎侧新能力单测（引擎删除策略 P0 / T02 验收点 2 与 4）。
 *
 * <p>与 {@code RagflowClientHttpTest} 同构：JDK 自带 {@link HttpServer} 起本地假 RAGFlow，
 * 让<b>真实</b> {@link RestClient} 打真实 HTTP，断言「线上字节」。
 *
 * <p>覆盖三件事：
 * <ol>
 *   <li>{@code capabilities()} 的 {@code deleteSupported} 严格随配置走，false 时
 *       {@code capabilities} 数组不含 {@code "delete"}（前端物理删除按钮的唯一依据）；</li>
 *   <li>{@code listLibraries()} 的分页终止条件——不足一页即停、触顶 max-pages 即停。
 *       这两条终止条件若写错，对账任务要么少拉数据、要么在引擎侧 dataset 巨多时死循环
 *       把定时线程占死；</li>
 *   <li>{@code createLibrary()} 下发的 dataset 名确实经过命名规范加工，
 *       {@code renameLibrary()} 发的是 PUT + {@code {"name": ...}}。</li>
 * </ol>
 */
@DisplayName("T02 RagflowAdapter 引擎能力")
class RagflowAdapterEngineOpsTest {

    private static final String API_KEY = "test-api-key";

    private HttpServer server;
    private String baseUrl;

    private final AtomicInteger listCalls = new AtomicInteger();
    private final List<String> listQueries = new ArrayList<>();
    private final AtomicReference<String> lastMethod = new AtomicReference<>();
    private final AtomicReference<String> lastPath = new AtomicReference<>();
    private final AtomicReference<String> lastBody = new AtomicReference<>();

    /** 假引擎侧的 dataset 总数，分页由 handler 按 page/page_size 切。 */
    private final AtomicInteger totalDatasets = new AtomicInteger(0);

    @BeforeEach
    void setUp() throws IOException {
        listCalls.set(0);
        listQueries.clear();
        totalDatasets.set(0);

        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            lastMethod.set(exchange.getRequestMethod());
            lastPath.set(exchange.getRequestURI().getPath());
            lastBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));

            String response;
            if ("GET".equals(exchange.getRequestMethod())) {
                listCalls.incrementAndGet();
                String query = exchange.getRequestURI().getQuery();
                listQueries.add(query);
                response = pageBody(query);
            } else if ("POST".equals(exchange.getRequestMethod())) {
                response = "{\"code\":0,\"message\":\"ok\",\"data\":{\"id\":\"ds-new\"}}";
            } else {
                response = "{\"code\":0,\"message\":\"ok\",\"data\":null}";
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

    /** 按 page/page_size 切出该页的 dataset 数组。 */
    private String pageBody(String query) {
        int page = intParam(query, "page", 1);
        int pageSize = intParam(query, "page_size", 100);
        int total = totalDatasets.get();
        int from = (page - 1) * pageSize;
        int to = Math.min(from + pageSize, total);
        StringBuilder sb = new StringBuilder("{\"code\":0,\"message\":\"ok\",\"data\":[");
        for (int i = from; i < to; i++) {
            if (i > from) {
                sb.append(',');
            }
            sb.append("{\"id\":\"ds-").append(i)
                    .append("\",\"name\":\"dataset-").append(i)
                    .append("\",\"document_count\":").append(i)
                    .append(",\"update_time\":1754870000000}");
        }
        return sb.append("]}").toString();
    }

    private static int intParam(String query, String key, int fallback) {
        if (query == null) {
            return fallback;
        }
        for (String pair : query.split("&")) {
            String[] kv = pair.split("=", 2);
            if (kv.length == 2 && kv[0].equals(key)) {
                try {
                    return Integer.parseInt(kv[1]);
                } catch (NumberFormatException ignored) {
                    return fallback;
                }
            }
        }
        return fallback;
    }

    private RagflowProperties props() {
        RagflowProperties props = new RagflowProperties();
        props.setType("ragflow");
        props.setBaseUrl(baseUrl);
        props.setApiKey(API_KEY);
        return props;
    }

    private RagflowAdapter adapter(RagflowProperties props) {
        return new RagflowAdapter(props, RestClient.builder(),
                mock(KbLibraryRepository.class), mock(KbDocumentRepository.class));
    }

    // ------------------------------------------------------------------ 能力位

    @Nested
    @DisplayName("capabilities()：删除能力位随配置")
    class Capabilities {

        @Test
        @DisplayName("delete-supported=false（当前生产默认）→ deleteSupported=false 且数组不含 delete")
        void shouldReportDeleteUnsupportedByDefault() {
            RagflowProperties props = props();
            assertFalse(props.isDeleteSupported(), "默认必须是 false，翻默认值等于放开物理删除");

            EngineCapabilities caps = adapter(props).capabilities();

            assertFalse(caps.deleteSupported());
            assertFalse(caps.capabilities().contains(EngineCapabilities.CAP_DELETE));
            // 其余能力位不受影响
            assertTrue(caps.hybridSupported());
            assertTrue(caps.metadataFilterSupported());
            assertTrue(caps.replaceSupported());
            assertFalse(caps.rerankSupported(), "未配 rerank 模型时 rerank 也应为 false");
        }

        @Test
        @DisplayName("delete-supported=true（RAGFLOW 升级后）→ 数组出现 delete，代码分支无需改动")
        void shouldReportDeleteSupportedWhenConfigured() {
            RagflowProperties props = props();
            props.setDeleteSupported(true);
            props.setRerankModelId("BAAI/bge-reranker-v2-m3");

            EngineCapabilities caps = adapter(props).capabilities();

            assertTrue(caps.deleteSupported());
            assertTrue(caps.capabilities().contains(EngineCapabilities.CAP_DELETE));
            assertTrue(caps.rerankSupported());
        }

        @Test
        @DisplayName("能力声明是纯本地判断，不打引擎（启动探测已被 Q5 裁定不做）")
        void shouldNotProbeEngine() {
            adapter(props()).capabilities();

            assertEquals(0, listCalls.get());
        }
    }

    // ------------------------------------------------------------------ 分页

    @Nested
    @DisplayName("listLibraries()：分页终止条件")
    class ListLibraries {

        @Test
        @DisplayName("不足一页即停：25 条 / pageSize=10 → 拉 3 页后停")
        void shouldStopOnPartialPage() {
            totalDatasets.set(25);
            RagflowProperties props = props();
            props.getReconcile().setPageSize(10);
            props.getReconcile().setMaxPages(50);

            List<EngineLibraryBrief> result = adapter(props).listLibraries();

            assertEquals(25, result.size());
            assertEquals(3, listCalls.get(), "第 3 页只有 5 条（<pageSize）就该收手");
            assertEquals("ds-0", result.get(0).nativeId());
            assertEquals("dataset-0", result.get(0).name());
            assertEquals(0, result.get(0).documentCount());
        }

        @Test
        @DisplayName("正好整页：20 条 / pageSize=10 → 多探一页拿到空页才停")
        void shouldStopOnEmptyPageWhenExactMultiple() {
            totalDatasets.set(20);
            RagflowProperties props = props();
            props.getReconcile().setPageSize(10);

            List<EngineLibraryBrief> result = adapter(props).listLibraries();

            assertEquals(20, result.size());
            assertEquals(3, listCalls.get(), "整页时必须再探一页，否则会漏掉刚好边界上的数据");
        }

        @Test
        @DisplayName("触顶 max-pages 即停，返回已拉到的部分而不是抛异常")
        void shouldStopAtMaxPages() {
            totalDatasets.set(1000);
            RagflowProperties props = props();
            props.getReconcile().setPageSize(10);
            props.getReconcile().setMaxPages(3);

            List<EngineLibraryBrief> result = adapter(props).listLibraries();

            assertEquals(30, result.size(), "触顶时返回部分结果，让对账仍能发现大部分差异");
            assertEquals(3, listCalls.get(), "绝不能越过 max-pages 继续翻页");
        }

        @Test
        @DisplayName("page 从 1 起、page_size 按配置下发（与 listDocuments 口径一致）")
        void shouldSendOneBasedPaging() {
            totalDatasets.set(5);
            RagflowProperties props = props();
            props.getReconcile().setPageSize(10);

            adapter(props).listLibraries();

            assertEquals(1, listQueries.size());
            assertTrue(listQueries.get(0).contains("page=1"), "实际=" + listQueries.get(0));
            assertTrue(listQueries.get(0).contains("page_size=10"), "实际=" + listQueries.get(0));
        }

        @Test
        @DisplayName("配置被写坏（pageSize=0 / maxPages=0）时归一化，不死循环也不空转")
        void shouldNormalizeBadConfig() {
            totalDatasets.set(2);
            RagflowProperties props = props();
            props.getReconcile().setPageSize(0);
            props.getReconcile().setMaxPages(0);

            List<EngineLibraryBrief> result = adapter(props).listLibraries();

            assertEquals(1, props.getReconcile().effectivePageSize());
            assertEquals(1, props.getReconcile().effectiveMaxPages());
            assertEquals(1, result.size(), "maxPages 归一到 1，只拉一页");
            assertEquals(1, listCalls.get());
        }

        @Test
        @DisplayName("引擎侧空库 → 返回空列表且只打一次请求")
        void shouldReturnEmptyList() {
            totalDatasets.set(0);

            List<EngineLibraryBrief> result = adapter(props()).listLibraries();

            assertTrue(result.isEmpty());
            assertEquals(1, listCalls.get());
        }
    }

    // ------------------------------------------------------------------ 建库 / 改名

    @Nested
    @DisplayName("createLibrary / renameLibrary 下发的字节")
    class NamingOnTheWire {

        @Test
        @DisplayName("建库下发的 dataset 名 = 一级分类-库名-ID后6位（加工封在 adapter 层）")
        void shouldSendComposedDatasetName() {
            EngineLibraryRef ref = adapter(props()).createLibrary(new CreateLibraryCmd(
                    "报销制度", "internal", 1L, null, 1_954_321_987_654_321L, "财务"));

            assertEquals("POST", lastMethod.get());
            assertEquals("/api/v1/datasets", lastPath.get());
            assertTrue(lastBody.get().contains("财务-报销制度-654321"),
                    "引擎侧看到的必须是加工后的名字，实际 body=" + lastBody.get());
            assertEquals("ragflow", ref.engineType());
            assertEquals("ds-new", ref.nativeId());
        }

        @Test
        @DisplayName("改名走 PUT /api/v1/datasets/{id}，body 只有 name")
        void shouldSendPutForRename() {
            adapter(props()).renameLibrary(
                    new EngineLibraryRef("ragflow", "ds-1"), "[已归档-20260811]-财务-报销制度-654321");

            assertEquals("PUT", lastMethod.get());
            assertEquals("/api/v1/datasets/ds-1", lastPath.get());
            assertTrue(lastBody.get().contains("[已归档-20260811]-财务-报销制度-654321"));
        }

        @Test
        @DisplayName("引擎引用为空时改名被跳过，不发出请求（避免打到 /datasets/null）")
        void shouldSkipRenameWhenRefBlank() {
            lastMethod.set(null);

            adapter(props()).renameLibrary(new EngineLibraryRef("ragflow", "  "), "任意名");

            assertEquals(null, lastMethod.get());
        }
    }
}
