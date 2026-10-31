package com.mis.adminbff.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.adminbff.config.AgentOpsProperties;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.web.reactive.function.client.WebClient;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * {@link AgentOpsClient} 大响应缓冲上限回归。
 *
 * <p>技能池 {@code GET /api/v1/skills?page_size=100} 在包技能增多后可超过 WebClient
 * 默认 256KB，越界被传输层误报为「下游不可达：Exceeded limit on max bytes to buffer」。
 * 本用例验证 16MB 上限生效。
 */
class AgentOpsClientLargeResponseTest {

    private static final int PAYLOAD_CHARS = 400_000;

    @Test
    @DisplayName("AgentOpsClient 能读回 >256KB 的技能列表信封（缓冲上限 16MB 生效）")
    void readsLargeSkillsList() throws IOException {
        HttpServer server;
        try {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        } catch (IOException e) {
            Assumptions.assumeTrue(false, "无法绑定本地端口，跳过：" + e.getMessage());
            return;
        }
        int port = server.getAddress().getPort();

        String filler = "x".repeat(PAYLOAD_CHARS);
        String body = "{\"code\":0,\"message\":\"ok\",\"data\":{"
                + "\"items\":[{\"id\":\"sm-shop-sale\",\"description\":\"" + filler + "\"}],"
                + "\"total\":1,\"page\":1,\"page_size\":100"
                + "}}";

        server.createContext("/api/v1/skills", exchange -> {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
        try {
            AgentOpsProperties props = new AgentOpsProperties();
            props.setBackendBaseUrl("http://127.0.0.1:" + port);
            props.setGatewayBaseUrl("http://127.0.0.1:" + port);
            AgentOpsClient client = new AgentOpsClient(WebClient.builder(), props, new ObjectMapper());

            JsonNode data = client.listSkills(Map.of("page", "1", "page_size", "100"));
            assertNotNull(data);
            assertEquals(1, data.path("total").asInt());
            assertThat(data.path("items").get(0).path("description").asText())
                    .hasSize(PAYLOAD_CHARS);
        } finally {
            server.stop(0);
        }
    }
}
