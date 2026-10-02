package com.mis.adminbff.client;

import com.mis.adminbff.config.IqdProperties;
import com.mis.adminbff.dto.iqd.IqdAskLogVO;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.web.reactive.function.client.WebClient;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * {@link IqdClient} 大响应缓冲上限回归。
 *
 * <p><b>背景</b>：WebClient 默认只缓冲 256KB。问数审计列表 {@code GET
 * /api/v1/iqd/traces?limit=100} 实测约 290KB（每条审计含 {@code sql_text} /
 * {@code resolved_scope} / {@code plan_steps} / {@code wren_status_trail} 等
 * 长 JSON 字符串）。越界后抛 {@code DataBufferLimitException}，被
 * {@code catch (Exception)} 兜成「下游调用失败: HTTP 200」——状态码明明是
 * 200 却报下游失败，排查成本极高。
 *
 * <p>本测试用 JDK 自带的 {@link HttpServer} 在随机端口返回一份 &gt;256KB 的
 * 合法 Result 信封（不依赖真实 mis-iqd），验证 {@link IqdClient} 能完整读回，
 * 即 {@code MAX_IN_MEMORY_BYTES}（16MB）确实生效。回退到默认 256KB 时本用例
 * 必红——这是防回归的核心断言。
 */
class IqdClientLargeResponseTest {

    private static final int PAYLOAD_CHARS = 400_000;

    @Test
    @DisplayName("IqdClient 能读回 >256KB 的 Result 信封（缓冲上限 16MB 生效）")
    void readsLargeResponse() throws IOException {
        HttpServer server;
        try {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        } catch (IOException e) {
            Assumptions.assumeTrue(false, "无法绑定本地端口，跳过：" + e.getMessage());
            return;
        }
        int port = server.getAddress().getPort();

        // 400KB 长的合法 JSON 字符串字段（citations 就是 String 类型）。
        String filler = "x".repeat(PAYLOAD_CHARS);
        String body = "{\"code\":0,\"message\":\"ok\",\"data\":[{"
                + "\"id\":1,\"question\":\"q\",\"status\":\"succeeded\","
                + "\"citations\":\"" + filler + "\""
                + "}]}";

        server.createContext("/api/v1/iqd/traces", exchange -> {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
        try {
            IqdProperties props = new IqdProperties();
            props.setBaseUrl("http://127.0.0.1:" + port);
            // 用与生产同源的 builder（cloned + codecs 放宽）构造。
            IqdClient client = new IqdClient(WebClient.builder(), props);

            List<IqdAskLogVO> traces = client.listTraces(100, null, null);
            assertNotNull(traces);
            assertThat(traces).hasSize(1);
            assertThat(traces.get(0).getCitations()).hasSize(PAYLOAD_CHARS);
        } finally {
            server.stop(0);
        }
    }
}
