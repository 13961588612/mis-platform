package com.mis.adminbff.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.adminbff.client.AgentOpsClient;
import com.mis.adminbff.config.AgentOpsProperties;
import com.mis.adminbff.dto.agentops.WecomBotUpsertRequest;
import com.mis.adminbff.service.agentops.WecomBotFacadeService;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.reactive.function.client.WebClient;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 企微 Bot 域（§4.3 #48–#54）的 BFF 路由与下游路径回归测试。
 *
 * <h2>为什么测 {@link AgentOpsChannelController} 而不是 {@link AgentOpsController}</h2>
 * 企微域在 T03 起就独立成 {@code AgentOpsChannelController} + {@code WecomBotFacadeService}
 * （含 secret 脱敏加工），<b>不是</b>塞在透明透传的 {@code AgentOpsController} 里。
 * 7 条路由全部落在 {@code /api/v1/agent-ops/channels/wecom/bots...}，本测试逐条验证
 * 路由 → 门面转发 → {@code Result.ok} 响应形状。
 *
 * <h2>下游路径回归（真实 {@link HttpServer}）</h2>
 * 历史 bug 的根因在 {@link AgentOpsClient#WECOM_BOTS}：曾写成
 * {@code ADMIN + "/channels/wecom/bots"}（即 {@code /api/v1/admin/...}），而 T04 后端
 * 实际挂载在 {@code /api/v1/channels/wecom/bots}（无 {@code /admin} 段）——后端 404
 * 被 BFF 归一成「下游能力尚未实现：GET /api/v1/admin/channels/wecom/bots」。
 * 故这里用真实 {@code HttpServer} 记录线上实际收到的路径，逐条断言 Client 转发目标
 * 与后端契约一致：<b>不带 /admin</b>，#54 仍走 gateway {@code /admin/bots/health}。
 */
class AgentOpsWecomControllerTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    // ---------------------------------------------------------------
    // 第一组：Controller 路由 → Facade 转发（MockMvc standaloneSetup）
    // ---------------------------------------------------------------

    @Nested
    @DisplayName("Controller 7 条企微 Bot 路由转发")
    class ControllerRoutes {

        private WecomBotFacadeService facade;
        private MockMvc mockMvc;

        @BeforeEach
        void setUp() {
            facade = mock(WecomBotFacadeService.class);
            mockMvc = MockMvcBuilders.standaloneSetup(new AgentOpsChannelController(facade))
                    .build();
        }

        private static JsonNode botNode(String botId) {
            ObjectNode node = MAPPER.createObjectNode();
            node.put("bot_id", botId);
            node.put("name", "运营助手");
            node.put("enabled", true);
            node.put("secret_masked", "abc***xyz");
            return node;
        }

        @Test
        @DisplayName("#48 GET /channels/wecom/bots → facade.listBots()，Result.ok")
        void listBotsRoute() throws Exception {
            ArrayNode array = MAPPER.createArrayNode();
            array.add(botNode("wb-1"));
            when(facade.listBots()).thenReturn(array);

            mockMvc.perform(get("/api/v1/agent-ops/channels/wecom/bots"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0))
                    .andExpect(jsonPath("$.data[0].bot_id").value("wb-1"));

            verify(facade).listBots();
        }

        @Test
        @DisplayName("#49 POST /channels/wecom/bots → facade.createBot(request)，secret 必填校验在门面")
        void createBotRoute() throws Exception {
            when(facade.createBot(any())).thenReturn(botNode("wb-new"));

            mockMvc.perform(post("/api/v1/agent-ops/channels/wecom/bots")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"name\":\"新助手\",\"ws_url\":\"wss://wecom.example/bot\",\"secret\":\"s3cret\",\"bound_agent_id\":\"ag-1\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0))
                    .andExpect(jsonPath("$.data.bot_id").value("wb-new"));

            verify(facade).createBot(any(WecomBotUpsertRequest.class));
        }

        @Test
        @DisplayName("#50 PUT /channels/wecom/bots/{botId} → facade.updateBot(botId, request)，botId 透传")
        void updateBotRoute() throws Exception {
            when(facade.updateBot(eq("wb-1"), any())).thenReturn(botNode("wb-1"));

            mockMvc.perform(put("/api/v1/agent-ops/channels/wecom/bots/wb-1")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"name\":\"改名\",\"ws_url\":\"wss://wecom.example/bot\",\"bound_agent_id\":\"ag-2\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0));

            verify(facade).updateBot(eq("wb-1"), any(WecomBotUpsertRequest.class));
        }

        @Test
        @DisplayName("#51 DELETE /channels/wecom/bots/{botId} → facade.deleteBot(botId)")
        void deleteBotRoute() throws Exception {
            when(facade.deleteBot("wb-1")).thenReturn(MAPPER.createObjectNode());

            mockMvc.perform(delete("/api/v1/agent-ops/channels/wecom/bots/wb-1"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0));

            verify(facade).deleteBot("wb-1");
        }

        @Test
        @DisplayName("#52 POST /channels/wecom/bots/{botId}/enable → facade.toggleBot(botId, \"enable\")")
        void enableBotRoute() throws Exception {
            when(facade.toggleBot("wb-1", "enable")).thenReturn(botNode("wb-1"));

            mockMvc.perform(post("/api/v1/agent-ops/channels/wecom/bots/wb-1/enable"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0));

            verify(facade).toggleBot("wb-1", "enable");
        }

        @Test
        @DisplayName("#53 POST /channels/wecom/bots/{botId}/disable → facade.toggleBot(botId, \"disable\")")
        void disableBotRoute() throws Exception {
            when(facade.toggleBot("wb-1", "disable")).thenReturn(botNode("wb-1"));

            mockMvc.perform(post("/api/v1/agent-ops/channels/wecom/bots/wb-1/disable"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0));

            verify(facade).toggleBot("wb-1", "disable");
        }

        @Test
        @DisplayName("#54 GET /channels/wecom/bots/health → facade.healthBots()")
        void healthBotsRoute() throws Exception {
            ObjectNode health = MAPPER.createObjectNode();
            health.put("wb-1", "connected");
            when(facade.healthBots()).thenReturn(health);

            mockMvc.perform(get("/api/v1/agent-ops/channels/wecom/bots/health"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0))
                    .andExpect(jsonPath("$.data.wb-1").value("connected"));

            verify(facade).healthBots();
        }
    }

    // ---------------------------------------------------------------
    // 第二组：Client 下游路径回归（真实 HttpServer 记录实际请求路径）
    // ---------------------------------------------------------------

    @Nested
    @DisplayName("Client 下游转发路径（回归：/admin 段必须不存在）")
    class DownstreamPaths {

        private HttpServer server;
        private AgentOpsClient client;
        private final AtomicReference<String> receivedMethod = new AtomicReference<>();
        private final AtomicReference<String> receivedPath = new AtomicReference<>();
        private final AtomicReference<String> receivedBody = new AtomicReference<>();

        @BeforeEach
        void setUp() throws IOException {
            receivedMethod.set(null);
            receivedPath.set(null);
            receivedBody.set(null);

            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", exchange -> {
                receivedMethod.set(exchange.getRequestMethod());
                receivedPath.set(exchange.getRequestURI().getPath());
                byte[] body = "{\"code\":0,\"message\":\"ok\",\"data\":{}}".getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", MediaType.APPLICATION_JSON_VALUE);
                exchange.sendResponseHeaders(200, body.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(body);
                }
            });
            server.start();

            AgentOpsProperties properties = new AgentOpsProperties();
            properties.setBackendBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
            properties.setGatewayBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
            properties.setTimeoutMs(2000);
            properties.setChatTimeoutMs(2000);
            client = new AgentOpsClient(WebClient.builder(), properties, MAPPER);
        }

        @AfterEach
        void tearDown() {
            if (server != null) {
                server.stop(0);
            }
        }

        @Test
        @DisplayName("#48 listWecomBots → GET /api/v1/channels/wecom/bots（不带 /admin）")
        void listWecomBotsPath() {
            client.listWecomBots();

            assertEquals("GET", receivedMethod.get());
            assertEquals("/api/v1/channels/wecom/bots", receivedPath.get(),
                    "后端挂载于 /api/v1/channels/wecom/bots；带 /admin 段会 404 并被归一成『T04 未实现』");
        }

        @Test
        @DisplayName("#49 createWecomBot → POST /api/v1/channels/wecom/bots")
        void createWecomBotPath() {
            client.createWecomBot(MAPPER.createObjectNode().put("name", "x"));

            assertEquals("POST", receivedMethod.get());
            assertEquals("/api/v1/channels/wecom/bots", receivedPath.get());
        }

        @Test
        @DisplayName("#50 updateWecomBot → PUT /api/v1/channels/wecom/bots/{botId}")
        void updateWecomBotPath() {
            client.updateWecomBot("wb-1", MAPPER.createObjectNode().put("name", "x"));

            assertEquals("PUT", receivedMethod.get());
            assertEquals("/api/v1/channels/wecom/bots/wb-1", receivedPath.get());
        }

        @Test
        @DisplayName("#51 deleteWecomBot → DELETE /api/v1/channels/wecom/bots/{botId}")
        void deleteWecomBotPath() {
            client.deleteWecomBot("wb-1");

            assertEquals("DELETE", receivedMethod.get());
            assertEquals("/api/v1/channels/wecom/bots/wb-1", receivedPath.get());
        }

        @Test
        @DisplayName("#52 wecomBotToggle(enable) → POST /api/v1/channels/wecom/bots/{botId}/enable")
        void toggleEnablePath() {
            client.wecomBotToggle("wb-1", "enable");

            assertEquals("POST", receivedMethod.get());
            assertEquals("/api/v1/channels/wecom/bots/wb-1/enable", receivedPath.get());
        }

        @Test
        @DisplayName("#53 wecomBotToggle(disable) → POST /api/v1/channels/wecom/bots/{botId}/disable")
        void toggleDisablePath() {
            client.wecomBotToggle("wb-1", "disable");

            assertEquals("POST", receivedMethod.get());
            assertEquals("/api/v1/channels/wecom/bots/wb-1/disable", receivedPath.get());
        }

        @Test
        @DisplayName("#54 wecomBotsHealth → GET gateway /admin/bots/health（唯一走 gateway 的一条）")
        void healthPath() {
            client.wecomBotsHealth();

            assertEquals("GET", receivedMethod.get());
            assertEquals("/admin/bots/health", receivedPath.get(),
                    "#54 是唯一打 gateway 基址的端点，路径保持 /admin/bots/health");
        }
    }
}
