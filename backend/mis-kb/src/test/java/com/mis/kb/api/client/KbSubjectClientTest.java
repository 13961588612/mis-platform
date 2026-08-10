package com.mis.kb.api.client;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link KbSubjectClient#fetchUserRoleCodes} 单测（知识库域一期 T01 验收：
 * 复用 IAM 镜像，含降级空列表）。
 *
 * <p>用 JDK 自带 {@link HttpServer} 起一个本地假 IAM，让<b>真实</b> {@link RestClient}
 * 打真实 HTTP（复用 {@code RagflowClientHttpTest} 同款模式）——断言对「线上字节」的解析
 * 与降级路径，Mock 无法覆盖到 RestClient 实际反序列化的形态。
 */
class KbSubjectClientTest {

    private HttpServer server;
    private int port;

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.start();
        port = server.getAddress().getPort();
    }

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    private KbSubjectClient clientWithHandler(HttpHandler handler) {
        server.createContext("/internal/v1/users/", handler);
        return new KbSubjectClient(RestClient.builder(), "http://127.0.0.1:" + port);
    }

    private static void respond(HttpExchange exchange, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(200, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    @Test
    @DisplayName("fetchUserRoleCodes：解析 roles[].code，去重保序；同响应角色 id/部门 id 也解析")
    void parsesRoleCodes() {
        KbSubjectClient client = clientWithHandler(exchange -> respond(exchange,
                "{\"code\":0,\"message\":\"ok\",\"data\":{"
                        + "\"id\":\"10\",\"deptId\":\"200\",\"deptIds\":[\"200\",\"201\"],"
                        + "\"roles\":[{\"id\":\"100\",\"code\":\"TENANT_ADMIN\"},"
                        + "{\"id\":\"101\",\"code\":\"TENANT_ADMIN\"},"
                        + "{\"id\":\"102\",\"code\":\"VIEWER\"}]}}"));

        assertEquals(List.of("TENANT_ADMIN", "VIEWER"), client.fetchUserRoleCodes(10L));
        // 同一份 IAM 响应，其余取数口径（全局短路/祖先链/可见性共用）一并验证
        assertEquals(List.of(100L, 101L, 102L), client.fetchUserRoleIds(10L));
        assertEquals(List.of(200L, 201L), client.fetchUserDeptIds(10L));
    }

    @Test
    @DisplayName("fetchUserRoleCodes：IAM 返回 data=null → 降级空列表")
    void degradesWhenDataNull() {
        KbSubjectClient client = clientWithHandler(exchange ->
                respond(exchange, "{\"code\":0,\"message\":\"ok\",\"data\":null}"));

        assertTrue(client.fetchUserRoleCodes(10L).isEmpty());
        assertTrue(client.fetchUserRoleIds(10L).isEmpty());
    }

    @Test
    @DisplayName("fetchUserRoleCodes：roles 为空数组 → 空列表")
    void emptyRoles() {
        KbSubjectClient client = clientWithHandler(exchange -> respond(exchange,
                "{\"code\":0,\"message\":\"ok\",\"data\":{\"id\":\"10\",\"roles\":[]}}"));

        assertTrue(client.fetchUserRoleCodes(10L).isEmpty());
    }

    @Test
    @DisplayName("fetchUserRoleCodes：IAM 未配置（base-url 空）→ client null → 空列表")
    void degradesWhenIamNotConfigured() {
        KbSubjectClient client = new KbSubjectClient(RestClient.builder(), "");

        assertTrue(client.fetchUserRoleCodes(10L).isEmpty());
        assertTrue(client.fetchUserRoleIds(10L).isEmpty());
    }

    @Test
    @DisplayName("fetchUserRoleCodes：IAM 返回 500 → 异常降级空列表（安全侧收紧）")
    void degradesOnServerError() throws IOException {
        KbSubjectClient client = clientWithHandler(exchange -> {
            exchange.sendResponseHeaders(500, -1);
            exchange.close();
        });

        assertTrue(client.fetchUserRoleCodes(10L).isEmpty());
    }
}
