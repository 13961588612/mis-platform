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
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * {@link KbWebClient#listDocumentChunks} 关键字查询串编码回归测试。
 *
 * <p>守护与 {@code KbWebClientUriEncodingTest}（DEF-01）同一类缺陷：<b>已百分号编码的
 * URI 字符串不能再交给 {@code WebClient.uri(String)}</b>，否则 {@code DefaultUriBuilderFactory}
 * 的 {@code TEMPLATE_AND_VALUES} 会把 {@code %} 再编码一次（{@code %E5} → {@code %25E5}），
 * 下游 mis-kb 解码后得到字面量乱码，中文/空格关键字过滤必 0 命中。
 *
 * <p>本测试用真实 {@link HttpServer} 收请求，取 {@code getRawQuery()}（线上字节，不解码）
 * 断言 keywords 只编码一次、解码后还原为原文。
 */
class KbWebClientListChunksEncodingTest {

    /** 下游返回空切片页。 */
    private static final String EMPTY_CHUNKS_BODY = "{\"code\":0,\"message\":\"ok\",\"data\":"
            + "{\"stats\":{\"totalChunks\":0,\"totalCharacterCount\":0,\"chunkMethod\":null,"
            + "\"chunkTokenNum\":null,\"separator\":null,\"source\":null,\"chunkCount\":null,"
            + "\"tokenCount\":null},\"chunks\":[],\"total\":0,\"page\":1,\"pageSize\":50,"
            + "\"hint\":null}}";

    private HttpServer server;
    private KbWebClient client;

    private final AtomicReference<String> rawPath = new AtomicReference<>();
    private final AtomicReference<String> rawQuery = new AtomicReference<>();

    @BeforeEach
    void setUp() throws IOException {
        rawPath.set(null);
        rawQuery.set(null);

        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            URI requestUri = exchange.getRequestURI();
            // getRawPath/getRawQuery 是「线上字节」，绝不能用 getPath/getQuery（会解码，
            // 二次编码的痕迹恰好在解码后被抹平成看似正常的 %E5...，测了等于没测）。
            rawPath.set(requestUri.getRawPath());
            rawQuery.set(requestUri.getRawQuery());
            byte[] body = EMPTY_CHUNKS_BODY.getBytes(StandardCharsets.UTF_8);
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

    private static Map<String, String> splitRaw(String query) {
        Map<String, String> parsed = new LinkedHashMap<>();
        if (query == null || query.isEmpty()) {
            return parsed;
        }
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq < 0) {
                parsed.put(pair, "");
            } else {
                parsed.put(pair.substring(0, eq), pair.substring(eq + 1));
            }
        }
        return parsed;
    }

    private String rawValueOf(String name) {
        return splitRaw(rawQuery.get()).get(name);
    }

    private String decodedValueOf(String name) {
        String raw = rawValueOf(name);
        return raw == null ? null : URLDecoder.decode(raw, StandardCharsets.UTF_8);
    }

    @Test
    @DisplayName("中文关键字「季度」→ keywords=%E5%AD%A3%E5%BA%A6，不含 %25（DEF-01 不得回归）")
    void chineseKeywordEncodedExactlyOnce() {
        client.listDocumentChunks(100L, 1001L, "季度", 1, 50);

        assertNotNull(rawPath.get(), "下游必须真的收到了请求");
        assertEquals("/internal/v1/kb/libraries/100/documents/1001/chunks", rawPath.get());
        String query = rawQuery.get();
        assertNotNull(query);
        assertFalse(query.contains("%25"),
                () -> "查询串里出现 %25，说明已编码字符串又被 WebClient 编码了一次（DEF-01 回归）：" + query);
        assertEquals("季度", decodedValueOf("keywords"),
                "下游解码后必须还原成用户输入的原文，否则关键字过滤必然 0 命中");
        assertEquals("1", rawValueOf("page"));
        assertEquals("50", rawValueOf("pageSize"));
    }

    @Test
    @DisplayName("含空格关键字「Alpha Beta」→ keywords=Alpha%20Beta，不含 %25")
    void spacedKeywordEncodedExactlyOnce() {
        client.listDocumentChunks(100L, 1001L, "Alpha Beta", 1, 50);

        assertFalse(rawQuery.get().contains("%25"),
                () -> "查询串里出现 %25（DEF-01 回归）：" + rawQuery.get());
        assertEquals("Alpha Beta", decodedValueOf("keywords"));
    }

    @Test
    @DisplayName("无关键字：不携带 keywords 参数（「没传」≠「传了空值」）")
    void blankKeywordNotSent() {
        client.listDocumentChunks(100L, 1001L, null, 2, 100);

        assertEquals("/internal/v1/kb/libraries/100/documents/1001/chunks", rawPath.get());
        Map<String, String> parsed = splitRaw(rawQuery.get());
        assertEquals(2, parsed.size(), () -> "只应带 page/pageSize，实际：" + rawQuery.get());
        assertEquals("2", parsed.get("page"));
        assertEquals("100", parsed.get("pageSize"));
    }
}
