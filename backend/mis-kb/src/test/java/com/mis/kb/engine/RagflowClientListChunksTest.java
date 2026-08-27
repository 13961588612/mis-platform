package com.mis.kb.engine;

import com.mis.common.core.exception.BusinessException;
import com.mis.kb.engine.dto.RfDocumentChunk;
import com.mis.kb.engine.dto.RfDocumentChunkPage;
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
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link RagflowClient#listChunks} 反序列化 + 参数透传测试。
 *
 * <p>与既有 {@code RagflowClientMissingTest} 同构：JDK {@link HttpServer} 起本地假 RAGFlow，
 * 真实 {@link RestClient} 打真实 HTTP；{@link AtomicReference} 记录「下一个响应」与最近一次
 * 请求行（path?query），用于断言 keywords/page/page_size 是否按预期透传。
 *
 * <p>契约（现网探测结论）：page 1-based；keywords 服务端过滤；响应
 * {@code data{chunks[], doc, total}}；chunk 含 {@code positions}（首元素=页码）与
 * {@code <em>} 高亮正文；未知字段忽略。
 */
class RagflowClientListChunksTest {

    private static final String API_KEY = "test-api-key";

    private HttpServer server;
    private final AtomicReference<String> responseBody = new AtomicReference<>(
            "{\"code\":0,\"message\":\"ok\",\"data\":null}");
    private final AtomicReference<String> lastRequestLine = new AtomicReference<>("");
    private String baseUrl;

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

    private static String chunksBody() {
        return """
                {
                  "code": 0,
                  "message": "ok",
                  "data": {
                    "chunks": [
                      {
                        "id": "chunk-1",
                        "content": "第一段<em>关键</em>内容",
                        "document_id": "doc-1",
                        "positions": [[1, 0, 0, 0, 0]],
                        "important_keywords": ["关键", "RAGFlow"]
                      },
                      {
                        "id": "chunk-2",
                        "content": "第二段内容",
                        "document_id": "doc-1",
                        "positions": [[2, 10, 20, 30, 40]],
                        "important_keywords": []
                      }
                    ],
                    "doc": {
                      "id": "doc-1",
                      "name": "测试.pdf",
                      "parser_config": {
                        "chunk_method": "naive",
                        "chunk_token_num": 1024,
                        "delimiter": "\\\\n"
                      },
                      "chunk_count": 2,
                      "token_count": 3456
                    },
                    "total": 2
                  }
                }
                """;
    }

    @Test
    @DisplayName("成功响应：反序列化 chunks/doc/total，positions 首元素即页码")
    void successDeserializesChunksAndPage() {
        responseBody.set(chunksBody());
        RfDocumentChunkPage page = newClient().listChunks("ds-1", "doc-1", null, 1, 50);

        assertEquals(2, page.total());
        assertEquals("doc-1", page.doc().id());
        assertEquals("测试.pdf", page.doc().name());
        assertEquals("naive", page.doc().parserConfig().chunkMethod());
        assertEquals(1024, page.doc().parserConfig().chunkTokenNum());
        assertEquals("\\n", page.doc().parserConfig().delimiter());
        assertEquals(2, page.chunks().size());

        RfDocumentChunk first = page.chunks().get(0);
        assertEquals("chunk-1", first.id());
        assertEquals("第一段<em>关键</em>内容", first.content());
        assertEquals(Integer.valueOf(1), first.pageNo());
        // important_keywords 反序列化：非空列表 / 空数组均正确
        assertEquals(java.util.List.of("关键", "RAGFlow"), first.importantKeywords());
        assertEquals(java.util.List.of(), page.chunks().get(1).importantKeywords());
        // doc 级统计反序列化：chunk_count / token_count（双口径数据源）
        assertEquals(Integer.valueOf(2), page.doc().chunkCount());
        assertEquals(Integer.valueOf(3456), page.doc().tokenCount());

        RfDocumentChunk second = page.chunks().get(1);
        assertEquals(Integer.valueOf(2), second.pageNo());
        // 引擎原生字段不下发前端，但 DTO 层保留原生 document_id 供适配层翻译
        assertEquals("doc-1", second.documentId());
    }

    @Test
    @DisplayName("positions 缺失/空：pageNo 返回 null（有则展示、无则降级）")
    void missingPositionsYieldsNullPageNo() {
        responseBody.set("""
                {
                  "code": 0,
                  "message": "ok",
                  "data": {
                    "chunks": [
                      {"id": "c1", "content": "纯文本无页码", "document_id": "doc-1"}
                    ],
                    "doc": {"id": "doc-1", "name": "a.txt"},
                    "total": 1
                  }
                }
                """);
        RfDocumentChunkPage page = newClient().listChunks("ds-1", "doc-1", null, 1, 50);

        assertEquals(1, page.chunks().size());
        assertNull(page.chunks().get(0).pageNo());
    }

    @Test
    @DisplayName("keywords 透传：非空时携带 keywords 查询参数；为空时不携带")
    void keywordsPassedOnlyWhenPresent() {
        responseBody.set(chunksBody());

        newClient().listChunks("ds-1", "doc-1", "关键", 1, 50);
        String withKw = lastRequestLine.get();
        assertTrue(withKw.contains("/api/v1/datasets/ds-1/documents/doc-1/chunks"));
        assertTrue(withKw.contains("keywords=%E5%85%B3%E9%94%AE") || withKw.contains("keywords=关键"),
                "keywords 应透传，实际请求行: " + withKw);
        assertTrue(withKw.contains("page=1"));
        assertTrue(withKw.contains("page_size=50"));

        newClient().listChunks("ds-1", "doc-1", null, 2, 100);
        String withoutKw = lastRequestLine.get();
        assertTrue(!withoutKw.contains("keywords"), "空关键字不得携带 keywords 参数: " + withoutKw);
        assertTrue(withoutKw.contains("page=2"));
        assertTrue(withoutKw.contains("page_size=100"));
    }

    @Test
    @DisplayName("空列表：chunks 为空列表、total=0，不抛异常")
    void emptyChunksIsOk() {
        responseBody.set("""
                {
                  "code": 0,
                  "message": "ok",
                  "data": {"chunks": [], "doc": {"id": "doc-1", "name": "a.pdf"}, "total": 0}
                }
                """);
        RfDocumentChunkPage page = newClient().listChunks("ds-1", "doc-1", null, 1, 50);

        assertEquals(0, page.total());
        assertTrue(page.chunks().isEmpty());
    }

    @Test
    @DisplayName("业务 code!=0：抛 BusinessException（引擎错误不静默）")
    void businessErrorThrows() {
        responseBody.set("{\"code\":102,\"message\":\"dataset not found\",\"data\":null}");

        BusinessException ex = assertThrows(BusinessException.class,
                () -> newClient().listChunks("ds-1", "doc-1", null, 1, 50));
        assertEquals(50000, ex.getCode());
        assertTrue(ex.getMessage().contains("查询文档切片失败"));
        assertTrue(ex.getMessage().contains("dataset not found"));
    }

    @Test
    @DisplayName("dataset/docId 为空：参数校验直接抛 BusinessException，不发起请求")
    void blankIdsRejected() {
        assertThrows(BusinessException.class,
                () -> newClient().listChunks("", "doc-1", null, 1, 50));
        assertThrows(BusinessException.class,
                () -> newClient().listChunks("ds-1", "", null, 1, 50));
        assertThrows(BusinessException.class,
                () -> newClient().listChunks(null, "doc-1", null, 1, 50));
        assertEquals("", lastRequestLine.get(), "参数非法时不得发起 HTTP 请求");
    }
}
