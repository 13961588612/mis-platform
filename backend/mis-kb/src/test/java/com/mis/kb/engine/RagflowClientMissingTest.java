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
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Q1 engineMissing 判定口径回归测试（deleteDataset / renameDataset）。
 *
 * <p><b>判定口径（架构师定稿）：</b>
 * <ul>
 *   <li>{@code deleteDataset}：HTTP 404 → {@link EngineDatasetMissingException}
 *       （原「404 静默幂等」已废弃）；业务 {@code code != 0} + 缺失文案同样判 missing；</li>
 *   <li>{@code renameDataset}：HTTP 404 → missing；业务 {@code code != 0} + message 命中
 *       {@code not found / not exist / 不存在 / missing / lacks permission}（不区分大小写）→ missing；
 *       否则维持 {@link BusinessException}(50000)；</li>
 *   <li><b>403+lacks permission 扩展（2026-08-xx 用户实测）</b>：RAGFlow 批量删除接口
 *       {@code DELETE /api/v1/datasets} 对<b>已不存在的 dataset</b> 返回 HTTP 403 +
 *       {@code lacks permission for datasets: 'xxx'}（不是 404）——deleteDataset / renameDataset
 *       遇此形态同样抛 {@link EngineDatasetMissingException}；<b>只认 {@code lacks permission}</b>，
 *       403 + 其它文案（{@code Forbidden} 等）不判 missing；</li>
 *   <li><b>非 missing 失败绝不误判</b>：405 / 500 / 普通业务错误仍是 BusinessException；</li>
 *   <li><b>deleteDocument 的 404 语义不受 Q1 影响</b>（仍走原 {@code deleteWithJsonBody}）：
 *       HTTP 404 维持原行为抛 {@link BusinessException}(50000)，<b>不</b>因 Q1 变成
 *       {@link EngineDatasetMissingException}——missing 信号只属于 dataset 级删除/改名。</li>
 * </ul>
 *
 * <p>与 {@code RagflowDeleteHttpTest} 同构：JDK {@link HttpServer} 起本地假 RAGFlow，
 * 让真实 {@link RestClient} 打真实 HTTP。
 */
class RagflowClientMissingTest {

    private static final String API_KEY = "test-api-key";

    /** 假 RAGFlow 的「下一个响应」：status + body，可随时替换。 */
    private record Stub(int status, String body) {
        static Stub ok() {
            return new Stub(200, "{\"code\":0,\"message\":\"ok\",\"data\":null}");
        }

        static Stub json(int status, String code, String message) {
            return new Stub(status, "{\"code\":" + code + ",\"message\":\"" + message + "\",\"data\":null}");
        }
    }

    private HttpServer server;
    private final AtomicReference<Stub> stub = new AtomicReference<>(Stub.ok());
    private String baseUrl;

    @BeforeEach
    void setUp() throws IOException {
        stub.set(Stub.ok());
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            Stub current = stub.get();
            byte[] bytes = current.body().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(current.status(), bytes.length);
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
    @DisplayName("deleteDataset：404 / 缺失文案 → EngineDatasetMissingException")
    class DeleteDatasetMissing {

        @Test
        @DisplayName("HTTP 404 → 抛 EngineDatasetMissingException（原静默幂等已废弃）")
        void deleteDataset404IsMissing() {
            stub.set(new Stub(404, "{\"code\":100,\"message\":\"Not Found\",\"data\":null}"));
            RagflowClient client = newClient();

            EngineDatasetMissingException ex = assertThrows(EngineDatasetMissingException.class,
                    () -> client.deleteDataset("ds-1"));
            assertTrue(ex.getMessage().contains("删除知识库"));
            assertTrue(ex.getMessage().contains("404"));
        }

        @Test
        @DisplayName("业务 code!=0 + message 命中 not found → 判 missing")
        void deleteDatasetBusinessMissingMessage() {
            stub.set(Stub.json(200, "101", "dataset not found"));
            RagflowClient client = newClient();

            assertThrows(EngineDatasetMissingException.class,
                    () -> client.deleteDataset("ds-1"));
        }

        @Test
        @DisplayName("业务 code!=0 + message 命中 missing（不区分大小写）→ 判 missing")
        void deleteDatasetBusinessMissingKeywordCaseInsensitive() {
            stub.set(Stub.json(200, "101", "The Dataset is MISSING"));
            RagflowClient client = newClient();

            assertThrows(EngineDatasetMissingException.class,
                    () -> client.deleteDataset("ds-1"));
        }

        @Test
        @DisplayName("HTTP 403 + lacks permission（RAGFlow 对已删 dataset 的真实返回）→ 判 missing")
        void deleteDataset403LacksPermissionIsMissing() {
            stub.set(new Stub(403, "{\"code\":100,\"message\":\"lacks permission for datasets: "
                    + "'66e5a448948a11f1b45c7dc3cecfbcd9'\",\"data\":null}"));
            RagflowClient client = newClient();

            EngineDatasetMissingException ex = assertThrows(EngineDatasetMissingException.class,
                    () -> client.deleteDataset("ds-1"));
            assertTrue(ex.getMessage().contains("删除知识库"));
            assertTrue(ex.getMessage().contains("403"));
        }

        @Test
        @DisplayName("业务 code!=0 + message 命中 lacks permission → 判 missing（双保险）")
        void deleteDatasetBusinessLacksPermissionMessage() {
            stub.set(Stub.json(200, "101", "lacks permission for datasets: '66e5a448948a11f1b45c7dc3cecfbcd9'"));
            RagflowClient client = newClient();

            assertThrows(EngineDatasetMissingException.class,
                    () -> client.deleteDataset("ds-1"));
        }
    }

    @Nested
    @DisplayName("deleteDataset：非 missing 失败不误判")
    class DeleteDatasetNotMissing {

        @Test
        @DisplayName("HTTP 405 → 仍抛 BusinessException（不是 missing）")
        void deleteDataset405IsNotMissing() {
            stub.set(new Stub(405, "{\"code\":100,\"message\":\"Method Not Allowed\",\"data\":null}"));
            RagflowClient client = newClient();

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> client.deleteDataset("ds-1"));
            assertEquals(50000, ex.getCode());
            assertTrue(ex.getMessage().contains("405"));
        }

        @Test
        @DisplayName("HTTP 403 + 其它文案（Forbidden）→ 仍抛 BusinessException，不误判 missing")
        void deleteDataset403OtherTextIsNotMissing() {
            stub.set(new Stub(403, "{\"code\":100,\"message\":\"Forbidden\",\"data\":null}"));
            RagflowClient client = newClient();

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> client.deleteDataset("ds-1"));
            assertEquals(50000, ex.getCode());
            assertTrue(ex.getMessage().contains("403"));
            assertTrue(ex.getMessage().contains("Forbidden"));
        }

        @Test
        @DisplayName("业务 code!=0 + 非缺失文案（重复名）→ 抛 BusinessException，不误判 missing")
        void deleteDatasetBusinessOtherErrorIsNotMissing() {
            stub.set(Stub.json(200, "102", "duplicate dataset name"));
            RagflowClient client = newClient();

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> client.deleteDataset("ds-1"));
            assertEquals(50000, ex.getCode());
            assertTrue(ex.getMessage().contains("duplicate"));
        }

        @Test
        @DisplayName("2xx code=0 → 正常成功，不抛异常")
        void deleteDatasetSucceeds() {
            assertDoesNotThrow(() -> newClient().deleteDataset("ds-1"));
        }
    }

    @Nested
    @DisplayName("renameDataset：404 / 缺失文案 → EngineDatasetMissingException")
    class RenameDatasetMissing {

        @Test
        @DisplayName("HTTP 404 → 抛 EngineDatasetMissingException")
        void renameDataset404IsMissing() {
            stub.set(new Stub(404, "{\"code\":100,\"message\":\"Not Found\",\"data\":null}"));
            RagflowClient client = newClient();

            EngineDatasetMissingException ex = assertThrows(EngineDatasetMissingException.class,
                    () -> client.renameDataset("ds-1", "arch-1"));
            assertTrue(ex.getMessage().contains("重命名"));
            assertTrue(ex.getMessage().contains("404"));
        }

        @Test
        @DisplayName("业务 code!=0 + message 命中 not exist → 判 missing")
        void renameDatasetBusinessNotExist() {
            stub.set(Stub.json(200, "101", "dataset does not exist"));
            RagflowClient client = newClient();

            assertThrows(EngineDatasetMissingException.class,
                    () -> client.renameDataset("ds-1", "arch-1"));
        }

        @Test
        @DisplayName("业务 code!=0 + message 命中中文「不存在」→ 判 missing")
        void renameDatasetBusinessChineseMissing() {
            stub.set(Stub.json(200, "101", "数据集不存在"));
            RagflowClient client = newClient();

            assertThrows(EngineDatasetMissingException.class,
                    () -> client.renameDataset("ds-1", "arch-1"));
        }

        @Test
        @DisplayName("业务 code!=0 + message 命中 missing（大小写不敏感）→ 判 missing")
        void renameDatasetBusinessMissingKeywordCaseInsensitive() {
            stub.set(Stub.json(200, "101", "Resource MISSING"));
            RagflowClient client = newClient();

            assertThrows(EngineDatasetMissingException.class,
                    () -> client.renameDataset("ds-1", "arch-1"));
        }

        @Test
        @DisplayName("HTTP 403 + lacks permission（RAGFlow 对已删 dataset 的真实返回）→ 判 missing")
        void renameDataset403LacksPermissionIsMissing() {
            stub.set(new Stub(403, "{\"code\":100,\"message\":\"lacks permission for datasets: "
                    + "'66e5a448948a11f1b45c7dc3cecfbcd9'\",\"data\":null}"));
            RagflowClient client = newClient();

            EngineDatasetMissingException ex = assertThrows(EngineDatasetMissingException.class,
                    () -> client.renameDataset("ds-1", "arch-1"));
            assertTrue(ex.getMessage().contains("重命名"));
            assertTrue(ex.getMessage().contains("403"));
        }
    }

    @Nested
    @DisplayName("renameDataset：非 missing 失败不误判")
    class RenameDatasetNotMissing {

        @Test
        @DisplayName("HTTP 500 → 仍抛 BusinessException（不是 missing）")
        void renameDataset500IsNotMissing() {
            stub.set(new Stub(500, "{\"code\":100,\"message\":\"Internal Error\",\"data\":null}"));
            RagflowClient client = newClient();

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> client.renameDataset("ds-1", "arch-1"));
            assertEquals(50000, ex.getCode());
            assertTrue(ex.getMessage().contains("500"));
        }

        @Test
        @DisplayName("HTTP 403 + 其它文案（Forbidden）→ 仍抛 BusinessException，不误判 missing")
        void renameDataset403OtherTextIsNotMissing() {
            stub.set(new Stub(403, "{\"code\":100,\"message\":\"Forbidden\",\"data\":null}"));
            RagflowClient client = newClient();

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> client.renameDataset("ds-1", "arch-1"));
            assertEquals(50000, ex.getCode());
            assertTrue(ex.getMessage().contains("403"));
            assertTrue(ex.getMessage().contains("Forbidden"));
        }

        @Test
        @DisplayName("业务 code!=0 + 非缺失文案（名称已存在）→ 抛 BusinessException，不误判 missing")
        void renameDatasetBusinessOtherErrorIsNotMissing() {
            stub.set(Stub.json(200, "102", "name already exists"));
            RagflowClient client = newClient();

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> client.renameDataset("ds-1", "arch-1"));
            assertEquals(50000, ex.getCode());
            assertTrue(ex.getMessage().contains("name already exists"));
        }

        @Test
        @DisplayName("2xx code=0 → 正常成功，不抛异常")
        void renameDatasetSucceeds() {
            assertDoesNotThrow(() -> newClient().renameDataset("ds-1", "arch-1"));
        }
    }

    @Nested
    @DisplayName("deleteDocument：404 语义不变（仍走原 deleteWithJsonBody）")
    class DeleteDocumentSemanticsUnchanged {

        @Test
        @DisplayName("deleteDocument 遇 HTTP 404 → 仍抛 BusinessException（Q1 只改 dataset 判定，不引入 missing 信号）")
        void deleteDocument404KeepsBusinessException() {
            stub.set(new Stub(404, "{\"code\":100,\"message\":\"Not Found\",\"data\":null}"));
            RagflowClient client = newClient();

            // 架构师口径：deleteDocument 的 404 语义「不受 Q1 影响」= 维持原 deleteWithJsonBody
            // 行为（HTTP 非 2xx → BusinessException 50000），绝不因 Q1 变成 EngineDatasetMissingException。
            BusinessException ex = assertThrows(BusinessException.class,
                    () -> client.deleteDocument("ds-1", "doc-1"),
                    "deleteDocument 不得因 Q1 引入 missing 信号");
            assertEquals(50000, ex.getCode());
            assertTrue(ex.getMessage().contains("404"));
        }

        @Test
        @DisplayName("deleteDocument 遇 HTTP 405 → 仍抛 BusinessException（显式失败不变）")
        void deleteDocument405StillThrows() {
            stub.set(new Stub(405, "{\"code\":100,\"message\":\"Method Not Allowed\",\"data\":null}"));
            RagflowClient client = newClient();

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> client.deleteDocument("ds-1", "doc-1"));
            assertEquals(50000, ex.getCode());
            assertTrue(ex.getMessage().contains("405"));
        }
    }
}
