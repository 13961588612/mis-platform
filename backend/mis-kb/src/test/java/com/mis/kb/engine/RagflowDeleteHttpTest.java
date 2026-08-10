package com.mis.kb.engine;

import com.mis.common.core.exception.BusinessException;
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
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@code RagflowClient.deleteDocument / deleteDataset} 的 DELETE 405 显式失败回归测试。
 *
 * <p><b>固化的缺陷（2026-08-12，远程 10.254.16.6:9380 实测）：</b>该 RAGFlow 实例
 * {@code DELETE /api/v1/datasets/{id}}、{@code DELETE /api/v1/datasets/{id}/documents/{docId}}
 * 均返回 <b>405 MethodNotAllowed</b>——这个版本根本不提供物理删除。旧实现用
 * {@code toBodilessEntity()} 吞掉错误体，405 被当成「成功」返回（静默假成功）：
 * 删除库/文档在引擎侧从未发生，却没有任何异常与告警。
 *
 * <p>与 {@code RagflowClientHttpTest} 同构：JDK {@link HttpServer} 起本地假 RAGFlow，
 * 让<b>真实</b> {@link RestClient} 打真实 HTTP 请求。断言 405 时抛
 * {@link BusinessException}（显式失败）而非静默；同时钉住 2xx 正常路径不受影响。
 */
class RagflowDeleteHttpTest {

    private static final String API_KEY = "test-api-key";

    /** 405 时 RAGFlow 风格的错误体（HTTP 405 + JSON 描述）。 */
    private static final String METHOD_NOT_ALLOWED_BODY =
            "{\"code\":100,\"message\":\"Method Not Allowed\",\"data\":null}";

    private HttpServer server;
    private final AtomicInteger requestCount = new AtomicInteger();
    private final AtomicReference<String> lastMethod = new AtomicReference<>();
    private final AtomicReference<String> lastPath = new AtomicReference<>();
    private final AtomicReference<String> lastAuth = new AtomicReference<>();

    /** 默认 DELETE 一律回 405；个别用例可关掉以验证 2xx 正常路径。 */
    private final AtomicBoolean deleteReturns405 = new AtomicBoolean(true);

    private String baseUrl;

    @BeforeEach
    void setUp() throws IOException {
        requestCount.set(0);
        lastMethod.set(null);
        lastPath.set(null);
        lastAuth.set(null);
        deleteReturns405.set(true);

        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            requestCount.incrementAndGet();
            lastMethod.set(exchange.getRequestMethod());
            lastPath.set(exchange.getRequestURI().getPath());
            lastAuth.set(exchange.getRequestHeaders().getFirst("Authorization"));

            boolean isDelete = "DELETE".equals(exchange.getRequestMethod());
            String response = (isDelete && deleteReturns405.get())
                    ? METHOD_NOT_ALLOWED_BODY
                    : "{\"code\":0,\"message\":\"ok\",\"data\":null}";
            int status = (isDelete && deleteReturns405.get()) ? 405 : 200;
            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, bytes.length);
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

    @Nested
    @DisplayName("T1：DELETE 405 显式失败（不再静默假成功）")
    class Delete405 {

        @Test
        @DisplayName("deleteDataset 遇 405 → 抛 BusinessException，消息含「删除知识库」与 405")
        void deleteDataset405Throws() {
            RagflowClient client = newClient();

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> client.deleteDataset("ds-1"),
                    "405 必须显式失败，绝不能再被 toBodilessEntity 吞成假成功");

            assertEquals("DELETE", lastMethod.get());
            assertEquals("/api/v1/datasets/ds-1", lastPath.get());
            assertEquals("Bearer " + API_KEY, lastAuth.get());
            assertTrue(ex.getMessage().contains("删除知识库"),
                    () -> "实际：" + ex.getMessage());
            assertTrue(ex.getMessage().contains("405"),
                    () -> "实际：" + ex.getMessage());
        }

        @Test
        @DisplayName("deleteDocument 遇 405 → 抛 BusinessException，消息含「删除文档」与 405")
        void deleteDocument405Throws() {
            RagflowClient client = newClient();

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> client.deleteDocument("ds-1", "doc-1"),
                    "405 必须显式失败，绝不能再被 toBodilessEntity 吞成假成功");

            assertEquals("DELETE", lastMethod.get());
            assertEquals("/api/v1/datasets/ds-1/documents/doc-1", lastPath.get());
            assertTrue(ex.getMessage().contains("删除文档"),
                    () -> "实际：" + ex.getMessage());
            assertTrue(ex.getMessage().contains("405"),
                    () -> "实际：" + ex.getMessage());
        }

        @Test
        @DisplayName("2xx 正常路径不受影响：deleteDocument 不抛异常，方法/路径/鉴权头正确")
        void deleteDocument2xxSucceeds() {
            deleteReturns405.set(false);
            RagflowClient client = newClient();

            assertDoesNotThrow(() -> client.deleteDocument("ds-1", "doc-1"));

            assertEquals("DELETE", lastMethod.get());
            assertEquals("/api/v1/datasets/ds-1/documents/doc-1", lastPath.get());
            assertEquals("Bearer " + API_KEY, lastAuth.get());
            assertEquals(1, requestCount.get());
        }

        @Test
        @DisplayName("2xx 正常路径不受影响：deleteDataset 不抛异常")
        void deleteDataset2xxSucceeds() {
            deleteReturns405.set(false);
            RagflowClient client = newClient();

            assertDoesNotThrow(() -> client.deleteDataset("ds-1"));

            assertEquals("DELETE", lastMethod.get());
            assertEquals("/api/v1/datasets/ds-1", lastPath.get());
        }
    }
}
