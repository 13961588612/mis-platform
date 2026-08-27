package com.mis.kb.engine;

import com.mis.kb.domain.entity.KbDocument;
import com.mis.kb.domain.entity.KbLibrary;
import com.mis.kb.domain.model.ChunkQuery;
import com.mis.kb.domain.model.DocumentChunkPageView;
import com.mis.kb.domain.model.DocumentChunkView;
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
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * {@link RagflowAdapter#listDocumentChunks} 映射 + 清洗 + 降级测试。
 *
 * <p>与 {@code RagflowAdapterEngineOpsTest} 同构：JDK {@link HttpServer} 起本地假 RAGFlow，
 * 真实 {@link RestClient} 打真实 HTTP；repository 用 Mockito 注入 MIS 库/文档映射。
 *
 * <p>覆盖契约：
 * <ul>
 *   <li>MIS libraryId/documentId → 引擎 dataset/doc 原生 id 翻译；返回视图只带 MIS documentId
 *       与清洗后纯文本（引擎原生 chunk id 绝不下发）；</li>
 *   <li>{@code cleanContent} 剥离 {@code <em>}/{@code <weight>}/{@code <sep>}/残留 HTML（杜绝 XSS）；</li>
 *   <li>库/文档无引擎映射 → 空页且不发起 HTTP；引擎报错 → 向上抛出（服务层降级为「引擎暂不可达」）。</li>
 * </ul>
 */
@DisplayName("T01 RagflowAdapter.listDocumentChunks")
class RagflowAdapterListChunksTest {

    private static final String API_KEY = "test-api-key";
    private static final long LIBRARY_ID = 7L;
    private static final long DOC_ID = 101L;

    private HttpServer server;
    private final AtomicReference<String> responseBody = new AtomicReference<>(
            "{\"code\":0,\"message\":\"ok\",\"data\":null}");
    private final AtomicReference<String> lastRequestLine = new AtomicReference<>("");
    private String baseUrl;

    private KbLibraryRepository libraryRepository;
    private KbDocumentRepository documentRepository;

    @BeforeEach
    void setUp() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            lastRequestLine.set(exchange.getRequestMethod() + " " + exchange.getRequestURI());
            byte[] bytes = responseBody.get().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();

        libraryRepository = mock(KbLibraryRepository.class);
        documentRepository = mock(KbDocumentRepository.class);
        when(libraryRepository.findById(LIBRARY_ID))
                .thenReturn(Optional.of(library()));
        when(documentRepository.findById(DOC_ID))
                .thenReturn(Optional.of(document()));
    }

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    private RagflowProperties props() {
        RagflowProperties props = new RagflowProperties();
        props.setType("ragflow");
        props.setBaseUrl(baseUrl);
        props.setApiKey(API_KEY);
        return props;
    }

    private RagflowAdapter adapter() {
        return new RagflowAdapter(props(), RestClient.builder(), libraryRepository, documentRepository);
    }

    private static KbLibrary library() {
        KbLibrary lib = new KbLibrary();
        lib.setId(LIBRARY_ID);
        lib.setName("测试库");
        lib.setEngineType("ragflow");
        lib.setEngineLibraryRef("ds-1");
        return lib;
    }

    private static KbDocument document() {
        KbDocument d = new KbDocument();
        d.setId(DOC_ID);
        d.setLibraryId(LIBRARY_ID);
        d.setTitle("测试.pdf");
        d.setEngineDocumentRef("doc-1");
        d.setParseStatus("success");
        return d;
    }

    private static String chunksBody() {
        return """
                {
                  "code": 0,
                  "message": "ok",
                  "data": {
                    "chunks": [
                      {"id": "c1", "content": "第一段<em>关键</em>内容", "document_id": "doc-1", "important_keywords": ["关键", "RAGFlow"], "positions": [[1,0,0,0,0]]},
                      {"id": "c2", "content": "第二段内容", "document_id": "doc-1", "important_keywords": [], "positions": [[2,0,0,0,0]]}
                    ],
                    "doc": {"id": "doc-1", "name": "测试.pdf", "parser_config": {"chunk_method": "naive"}, "chunk_count": 12, "token_count": 3456},
                    "total": 2
                  }
                }
                """;
    }

    @Nested
    @DisplayName("映射：MIS id 翻译 + 清洗 + 页码")
    class Mapping {

        @Test
        @DisplayName("happy path：返回视图只带 MIS documentId，content 已剥离 <em>，pageNo 取 positions 首元素")
        void mapsChunksWithMappedIds() {
            responseBody.set(chunksBody());

            DocumentChunkPageView view = adapter().listDocumentChunks(
                    new ChunkQuery(LIBRARY_ID, DOC_ID, null, 1, 50));

            assertEquals(2, view.total());
            assertEquals(2, view.chunks().size());
            DocumentChunkView first = view.chunks().get(0);
            assertEquals(DOC_ID, first.documentId());
            assertEquals("第一段关键内容", first.content());
            assertEquals(Integer.valueOf(1), first.pageNo());
            assertEquals(Integer.valueOf(2), view.chunks().get(1).pageNo());
            // importantKeywords 透传：非空列表原样、空数组保持空列表
            assertEquals(java.util.List.of("关键", "RAGFlow"), first.importantKeywords());
            assertEquals(java.util.List.of(), view.chunks().get(1).importantKeywords());
            // 文档级统计透传：全量 chunk 数 + token 数（双口径，不受关键字过滤影响）
            assertEquals(Integer.valueOf(12), view.chunkCount());
            assertEquals(Integer.valueOf(3456), view.tokenCount());
            // 引擎原生 dataset/doc id 只出现在请求行，不出现在返回视图
            assertTrue(lastRequestLine.get().contains("/api/v1/datasets/ds-1/documents/doc-1/chunks"));
        }

        @Test
        @DisplayName("keywords 透传：非空时携带 keywords 查询参数")
        void passesKeywordsThrough() {
            responseBody.set(chunksBody());

            adapter().listDocumentChunks(new ChunkQuery(LIBRARY_ID, DOC_ID, "关键", 2, 100));

            assertTrue(lastRequestLine.get().contains("page=2"));
            assertTrue(lastRequestLine.get().contains("page_size=100"));
            assertTrue(lastRequestLine.get().contains("keywords="),
                    "keywords 应透传给引擎，实际请求行: " + lastRequestLine.get());
        }
    }

    @Nested
    @DisplayName("降级：无引擎映射 / 引擎报错")
    class Degradation {

        @Test
        @DisplayName("库无引擎映射：返回空页且不发起 HTTP")
        void libraryWithoutEngineRefReturnsEmpty() {
            KbLibrary broken = library();
            broken.setEngineLibraryRef(null);
            when(libraryRepository.findById(LIBRARY_ID)).thenReturn(Optional.of(broken));

            DocumentChunkPageView view = adapter().listDocumentChunks(
                    new ChunkQuery(LIBRARY_ID, DOC_ID, null, 1, 50));

            assertEquals(0, view.total());
            assertTrue(view.chunks().isEmpty());
            assertEquals("", lastRequestLine.get(), "库无引擎映射时不得发起 HTTP 请求");
        }

        @Test
        @DisplayName("文档无引擎映射：返回空页且不发起 HTTP")
        void documentWithoutEngineRefReturnsEmpty() {
            KbDocument broken = document();
            broken.setEngineDocumentRef(null);
            when(documentRepository.findById(DOC_ID)).thenReturn(Optional.of(broken));

            DocumentChunkPageView view = adapter().listDocumentChunks(
                    new ChunkQuery(LIBRARY_ID, DOC_ID, null, 1, 50));

            assertEquals(0, view.total());
            assertTrue(view.chunks().isEmpty());
            assertEquals("", lastRequestLine.get(), "文档无引擎映射时不得发起 HTTP 请求");
        }

        @Test
        @DisplayName("引擎报错（code!=0）：向上抛出，不做静默空页（服务层负责降级提示）")
        void engineErrorPropagates() {
            responseBody.set("{\"code\":102,\"message\":\"engine boom\",\"data\":null}");

            assertThrows(RuntimeException.class, () -> adapter().listDocumentChunks(
                    new ChunkQuery(LIBRARY_ID, DOC_ID, null, 1, 50)));
        }
    }

    @Nested
    @DisplayName("cleanContent：剥离引擎标记与残留 HTML")
    class CleanContent {

        @Test
        @DisplayName("<em> 高亮剥离：<em>关键</em>内容 → 关键内容")
        void stripsEmHighlight() {
            assertEquals("第一段关键内容", RagflowAdapter.cleanContent("第一段<em>关键</em>内容"));
        }

        @Test
        @DisplayName("<weight>/<sep> 标记剥离（复用 RfSearchChunk 口径）")
        void stripsWeightAndSep() {
            assertEquals("高亮 后续",
                    RagflowAdapter.cleanContent("<weight 0.95>高亮</weight><sep/> 后续"));
        }

        @Test
        @DisplayName("残留 HTML 剥离并保留换行：表格单元格跨行可读")
        void stripsResidualHtmlKeepsNewlines() {
            assertEquals("a\nb",
                    RagflowAdapter.cleanContent("<table><tr>\n<td>a</td>\n<td>b</td>\n</tr></table>"));
        }

        @Test
        @DisplayName("混合嵌套标记：全部剥净，连续空白归一但保留换行")
        void stripsMixedMarkup() {
            String raw = "<weight 0.8><em>关键</em>词</weight>   <sep/>\n第二行";
            assertEquals("关键词\n第二行", RagflowAdapter.cleanContent(raw));
        }

        @Test
        @DisplayName("null / 空白：返回空串")
        void blankReturnsEmpty() {
            assertEquals("", RagflowAdapter.cleanContent(null));
            assertEquals("", RagflowAdapter.cleanContent("  \n\t "));
        }

        @Test
        @DisplayName("CRLF 归一：\\r\\n 与行首行尾空白 → 单 \\n")
        void crlfNormalizedToLf() {
            assertEquals("第一行\n第二行",
                    RagflowAdapter.cleanContent("第一行\r\n 第二行 \r\n"));
        }

        @Test
        @DisplayName("连续空行压为至多两个，首尾空白去除")
        void blankLinesCollapsed() {
            assertEquals("a\n\nb",
                    RagflowAdapter.cleanContent("  a\n\n\n\n\nb  "));
        }

        @Test
        @DisplayName("script/iframe 等潜在 XSS 标签全部剥净（只留纯文本）")
        void scriptTagsStripped() {
            String raw = "<script>alert('x')</script>正文<script>bad()</script>";
            assertEquals("alert('x')正文bad()",
                    RagflowAdapter.cleanContent(raw),
                    "脚本内容只剥标签不吞文本（清洗目标是标签本身，非脚本正文）");
        }

        @Test
        @DisplayName("带属性标签剥离：<table class=...>/<td style=...> 与闭标签一视同仁")
        void tagsWithAttributesStripped() {
            assertEquals("a\nb",
                    RagflowAdapter.cleanContent(
                            "<table class=\"tbl\"><tr><td style=\"width:10px\">a</td></tr>\n<tr><td>b</td></tr></table>"));
        }

        @Test
        @DisplayName("正文含裸 < 但无闭合 >：不是标签，原样保留（避免误删比较符）")
        void loneLtNotStripped() {
            assertEquals("a < b 且 c", RagflowAdapter.cleanContent("a < b 且 c"));
        }

        @Test
        @DisplayName("important_keywords 缺失（null）→ 空列表，不透传 null")
        void nullKeywordsMappedToEmptyList() {
            responseBody.set("""
                    {
                      "code": 0,
                      "message": "ok",
                      "data": {
                        "chunks": [
                          {"id": "c1", "content": "正文", "document_id": "doc-1", "positions": [[1,0,0,0,0]]}
                        ],
                        "doc": {"id": "doc-1", "name": "a.pdf"},
                        "total": 1
                      }
                    }
                    """);
            DocumentChunkPageView view = adapter().listDocumentChunks(
                    new ChunkQuery(LIBRARY_ID, DOC_ID, null, 1, 50));

            assertEquals(1, view.chunks().size());
            assertEquals(java.util.List.of(), view.chunks().get(0).importantKeywords());
        }
    }
}
