package com.mis.adminbff.client;

import com.mis.adminbff.config.BffProperties;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import org.springframework.web.reactive.function.client.WebClient;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * {@link KbWebClient#setDocumentEnabled} 布尔查询参数透传测试。
 *
 * <h2>背景</h2>
 * 本轮把 {@code setDocumentEnabled} 的「{@code buildAndExpand(...).toUriString()} +
 * {@code uri(String)}」统一为基类 {@code queryUri(...)}（{@code uri(Function<UriBuilder, URI>)}）。
 * {@code enabled} 是布尔量，不涉及非 ASCII 编码，但它与 {@code listDocumentChunks} 属同款
 * 写法统一改造 —— 本测试钉住「布尔参数行为不变」：
 * <ul>
 *   <li>路径 {@code /internal/v1/kb/libraries/{libraryId}/documents/{id}/enable} 原样送达，路径变量展开；</li>
 *   <li>查询串恒为 {@code enabled=true} / {@code enabled=false}（与原 {@code queryParam("enabled", …)} 一致，
 *       {@code "true"/"false"} 非空非空白，因此不会被 {@code queryUri} 的空白过滤吞掉）；</li>
 *   <li>HTTP 方法保持 {@code PUT}。</li>
 * </ul>
 * 写法沿用同目录 {@code KbWebClientReparseAllTest} 的「JDK HttpServer + 真实 WebClient」。
 */
class KbWebClientEnabledFlagTest {

    /** 下游返回空体（{@code Result<Void>}）。 */
    private static final String VOID_BODY = "{\"code\":0,\"message\":\"ok\",\"data\":null}";

    private HttpServer server;
    private KbWebClient client;

    private final AtomicReference<String> rawPath = new AtomicReference<>();
    private final AtomicReference<String> rawQuery = new AtomicReference<>();
    private final AtomicReference<String> method = new AtomicReference<>();

    @BeforeEach
    void setUp() throws IOException {
        rawPath.set(null);
        rawQuery.set(null);
        method.set(null);

        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            URI requestUri = exchange.getRequestURI();
            rawPath.set(requestUri.getRawPath());
            rawQuery.set(requestUri.getRawQuery());
            method.set(exchange.getRequestMethod());
            byte[] body = VOID_BODY.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", MediaType.APPLICATION_JSON_VALUE);
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(body);
            }
        });
        server.start();

        BffProperties properties = new BffProperties();
        properties.setKbDiscoveryEnabled(false);
        properties.setKbBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
        properties.setAggregateTimeoutMs(5000);

        client = new KbWebClient(
                WebClient.builder(),
                WebClient.builder(),
                properties,
                Jackson2ObjectMapperBuilder.json().build());
    }

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    @DisplayName("setDocumentEnabled(3, 44, true) → PUT .../enable?enabled=true")
    void enabledTruePassesThrough() {
        client.setDocumentEnabled(3L, 44L, true);

        assertEquals("/internal/v1/kb/libraries/3/documents/44/enable", rawPath.get(),
                "路径原样送达且路径变量展开");
        assertEquals("enabled=true", rawQuery.get(), "布尔 true 必须透传为 enabled=true");
        assertEquals("PUT", method.get());
    }

    @Test
    @DisplayName("setDocumentEnabled(5, 66, false) → PUT .../enable?enabled=false（布尔行为不变）")
    void enabledFalsePassesThrough() {
        client.setDocumentEnabled(5L, 66L, false);

        assertEquals("/internal/v1/kb/libraries/5/documents/66/enable", rawPath.get());
        assertEquals("enabled=false", rawQuery.get(),
                "布尔 false 必须透传为 enabled=false，不能被空白过滤吞掉");
        assertEquals("PUT", method.get());
    }
}
