package com.mis.adminbff.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.adminbff.support.DownstreamAuthContext;
import com.mis.common.core.constant.SecurityConstants;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.client.WebClient;

import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * {@link AgentOpsTransport} 的鉴权头透传回归测试 —— 直接守护「BFF→ai-platform
 * 下游调用 {@code GET /api/v1/agents} 返回 HTTP 401」这个 bug 的修复。
 *
 * <h2>为什么用真实 {@link HttpServer} 而不是 MockRestServiceServer</h2>
 * 修复点落在 {@code AgentOpsTransport.agentOpsHeaders()}：把
 * {@link DownstreamAuthContext#getToken()} 里的原始 MIS JWT 作为
 * {@code Authorization} 头补到下游请求里。要证明「下游真的拿到了 JWT」，最忠实、
 * 最不含糊的办法就是让真实的 {@link WebClient} 打一条真实的 HTTP 请求到本地
 * {@code HttpServer}，再由服务器把<b>线上实际收到的请求头</b>记下来做断言。
 * 这样既不依赖 Mock 框架对 {@code onStatus(...)} 的处理细节，也完全复刻了 401
 * 发生的那一跳：请求若不带 Authorization，ai-platform 的 {@code get_current_user}
 * 走不了 RS256 分支就会 401。
 *
 * <h2>回归护栏的语义</h2>
 * 任何人只要把 {@code .headers(this::agentOpsHeaders)} 回滚成
 * {@code .headers(loginContextHeaders())}，下游请求就不再带 Authorization，
 * {@code receivedAuthHeader} 断言立即失败 —— 这正是「401 又回来了」的早期报警。
 */
class AgentOpsTransportAuthHeaderTest {

    private HttpServer server;
    private int port;
    private WebClient webClient;
    private final ObjectMapper mapper = new ObjectMapper();
    private TestTransport transport;

    private final AtomicReference<String> receivedAuthHeader = new AtomicReference<>();
    private final AtomicReference<String> receivedMethod = new AtomicReference<>();
    private final AtomicReference<String> receivedPath = new AtomicReference<>();

    /** 由测试动态控制的下游客服响应。 */
    private volatile String responseBody = "{\"code\":0,\"message\":\"ok\",\"data\":[]}";
    private volatile int responseStatus = 200;

    @BeforeEach
    void setUp() throws IOException {
        receivedAuthHeader.set(null);
        receivedMethod.set(null);
        receivedPath.set(null);
        responseBody = "{\"code\":0,\"message\":\"ok\",\"data\":[]}";
        responseStatus = 200;

        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        port = server.getAddress().getPort();
        server.createContext("/", exchange -> {
            receivedMethod.set(exchange.getRequestMethod());
            receivedPath.set(exchange.getRequestURI().getPath());
            receivedAuthHeader.set(
                    exchange.getRequestHeaders().getFirst(SecurityConstants.AUTHORIZATION_HEADER));
            byte[] body = responseBody.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", MediaType.APPLICATION_JSON_VALUE);
            exchange.sendResponseHeaders(responseStatus, body.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(body);
            }
        });
        server.start();

        webClient = WebClient.builder().baseUrl("http://127.0.0.1:" + port).build();
        transport = new TestTransport(webClient, webClient, mapper);
    }

    @AfterEach
    void tearDown() {
        DownstreamAuthContext.clear();
        if (server != null) {
            server.stop(0);
        }
    }

    /** 暴露受保护动词的具体子类，让测试能驱动真实交换。 */
    static final class TestTransport extends AgentOpsTransport {
        TestTransport(WebClient backend, WebClient gateway, ObjectMapper mapper) {
            super(backend, gateway, 2000, 2000, mapper);
        }

        JsonNode listAgents() {
            return getJson(b -> b.path("/api/v1/agents").build(), "GET /api/v1/agents");
        }

        JsonNode gatewayHealth() {
            return getGatewayJson(b -> b.path("/admin/bots/health").build(),
                    "GET gateway /admin/bots/health");
        }
    }

    @Nested
    @DisplayName("401 回归：下游请求必须透传 MIS JWT（Authorization 头）")
    class JwtForwarding {

        @Test
        @DisplayName("GET /api/v1/agents 的下游请求携带 Authorization: Bearer <token>")
        void forwardsAuthorizationHeaderToBackend() {
            String jwt = "Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig";
            DownstreamAuthContext.setToken(jwt);

            JsonNode result = transport.listAgents();

            assertNotNull(result, "下游成功响应应解包出 data");
            assertEquals("GET", receivedMethod.get());
            assertEquals("/api/v1/agents", receivedPath.get());
            assertEquals(jwt, receivedAuthHeader.get(),
                    "修复前 transport 不透传 JWT，ai-platform get_current_user 验签失败 → 下游 401");
        }

        @Test
        @DisplayName("网关基址的下游（#54 企微健康探测）同样透传 Authorization 头")
        void forwardsAuthorizationHeaderToGateway() {
            String jwt = "Bearer gw.token.value.xyz";
            DownstreamAuthContext.setToken(jwt);

            transport.gatewayHealth();

            assertEquals("/admin/bots/health", receivedPath.get());
            assertEquals(jwt, receivedAuthHeader.get(),
                    "gateway 路径也走同一套 agentOpsHeaders，必须同样带 JWT");
        }
    }

    @Nested
    @DisplayName("无 token 时保持改造前行为：不加 Authorization 头（避免副作用）")
    class NoToken {

        @Test
        @DisplayName("未设置 token 时下游请求不含 Authorization 头")
        void noAuthorizationHeaderWhenNoToken() {
            DownstreamAuthContext.clear();
            transport.listAgents();
            assertNull(receivedAuthHeader.get(),
                    "无 JWT 时不应加 Authorization 头，保持改造前行为，避免对其它下游产生副作用");
        }
    }

    @Nested
    @DisplayName("回归护栏：证明修复前的行为会让下游拿到无 Authorization 的请求（即 401 根因）")
    class RegressionGuard {

        @Test
        @DisplayName("DownstreamAuthContext 有 token 时请求头确实带 Authorization —— 回滚 agentOpsHeaders 改动此断言必失败")
        void tokenPresentMeansHeaderSent() {
            DownstreamAuthContext.setToken("Bearer should-be-forwarded");
            transport.listAgents();
            assertEquals("Bearer should-be-forwarded", receivedAuthHeader.get());
        }
    }
}
