package com.mis.adminbff.client;

import com.mis.adminbff.config.BffProperties;
import com.mis.adminbff.dto.kb.KbReparseAllResultVO;
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
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * {@link KbWebClient#reparseAllDocuments} 透传测试（P1-1）。
 *
 * <p>沿用 {@code KbWebClientUriEncodingTest} 同款「JDK HttpServer + 真实 WebClient」写法：
 * 断言请求确实打在 {@code POST /internal/v1/kb/libraries/{libraryId}/documents/reparse-all}，
 * 且结构化结果（成功/失败/跳过 + 失败明细）能正确反序列化回 BFF DTO。
 */
class KbWebClientReparseAllTest {

    private static final String RESPONSE_BODY = "{\"code\":0,\"message\":\"ok\",\"data\":{"
            + "\"libraryId\":1,\"total\":3,\"success\":2,\"failed\":1,\"skipped\":0,"
            + "\"failedDocuments\":[{\"documentId\":99,\"title\":\"a.pdf\",\"reason\":\"boom\"}]}}";

    private HttpServer server;
    private KbWebClient client;

    private final AtomicReference<String> rawPath = new AtomicReference<>();
    private final AtomicReference<String> method = new AtomicReference<>();

    @BeforeEach
    void setUp() throws IOException {
        rawPath.set(null);
        method.set(null);

        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            URI requestUri = exchange.getRequestURI();
            rawPath.set(requestUri.getRawPath());
            method.set(exchange.getRequestMethod());
            byte[] body = RESPONSE_BODY.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", MediaType.APPLICATION_JSON_VALUE);
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(body);
            }
        });
        server.start();

        String authority = "127.0.0.1:" + server.getAddress().getPort();
        BffProperties properties = new BffProperties();
        properties.setKbDiscoveryEnabled(false);
        properties.setKbBaseUrl("http://" + authority);
        properties.setAggregateTimeoutMs(5000);

        client = new KbWebClient(
                WebClient.builder(),
                WebClient.builder(),
                properties,
                Jackson2ObjectMapperBuilder.json().build());
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    @Test
    @DisplayName("POST reparse-all 路径正确且结果反序列化完整")
    void reparseAllPostsCorrectPathAndDeserializes() {
        KbReparseAllResultVO result = client.reparseAllDocuments(1L);

        assertEquals("/internal/v1/kb/libraries/1/documents/reparse-all", rawPath.get());
        assertEquals("POST", method.get());

        assertNotNull(result);
        assertEquals(1L, result.libraryId());
        assertEquals(3, result.total());
        assertEquals(2, result.success());
        assertEquals(1, result.failed());
        assertEquals(0, result.skipped());
        assertNotNull(result.failedDocuments());
        assertEquals(1, result.failedDocuments().size());
        assertEquals(99L, result.failedDocuments().get(0).documentId());
        assertEquals("a.pdf", result.failedDocuments().get(0).title());
        assertEquals("boom", result.failedDocuments().get(0).reason());
    }
}
