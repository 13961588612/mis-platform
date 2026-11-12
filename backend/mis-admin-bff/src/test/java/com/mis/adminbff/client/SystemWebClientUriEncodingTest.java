package com.mis.adminbff.client;

import com.mis.adminbff.config.BffProperties;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.client.WebClient;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * {@code SystemWebClient} 出站 URI 统一修复回归测试。
 *
 * <h2>背景</h2>
 * 该客户端四处「模块/菜单关联 API」方法原先各自写：
 * <pre>
 *   String uri = UriComponentsBuilder.fromPath("/internal/v1/modules/{moduleId}/apis")
 *           .buildAndExpand(moduleId).toUriString();
 *   client().get().uri(uri)...
 * </pre>
 * 参数是 {@code Long}，双重编码对纯数字是空操作（「巧合安全」），但它是 DEF-01
 * 双重编码范式（{@code toUriString()} + {@code uri(String)}）的同款写法 ——
 * 一旦未来有人把参数换成非 ASCII，就会静默复现「中文筛选恒 0 条」。本轮把四处
 * 统一为 {@code uri(Function<UriBuilder, URI>)}：经 WebClient 自带的 {@code UriBuilder}
 * 展开，<b>baseUrl 保留且编码只发生一次</b>。
 *
 * <h2>为什么用真实 {@link HttpServer}</h2>
 * 证据全在真实发出的那一行请求里。这里让真实 {@link WebClient} 打真实请求到本地
 * {@link HttpServer}，用 {@code getRawPath()}/{@code getRawQuery()} 取未解码的线上字节，
 * 并核对 {@code Host} 头 —— 若有人改用 {@code uri(URI)} 传相对地址，baseUrl 会被整个丢弃，
 * 请求静默打到默认主机，{@code Host} 断言立刻红。
 */
class SystemWebClientUriEncodingTest {

    /** 下游返回空列表（list 型方法用）。 */
    private static final String EMPTY_LIST_BODY = "{\"code\":0,\"message\":\"ok\",\"data\":[]}";

    /** 下游返回空体（{@code menuApiReplace} 的 {@code Result<Void>} 用）。 */
    private static final String VOID_BODY = "{\"code\":0,\"message\":\"ok\",\"data\":null}";

    private HttpServer server;
    private SystemWebClient client;

    private final AtomicReference<String> rawPath = new AtomicReference<>();
    private final AtomicReference<String> rawQuery = new AtomicReference<>();
    private final AtomicReference<String> method = new AtomicReference<>();
    private final AtomicReference<String> hostHeader = new AtomicReference<>();

    /** 本轮假 mis-system 的 {@code host:port}，用于核对请求确实打在 baseUrl 指定的主机上。 */
    private String expectedAuthority = "";

    private volatile String responseBody = EMPTY_LIST_BODY;

    @BeforeEach
    void setUp() throws IOException {
        rawPath.set(null);
        rawQuery.set(null);
        method.set(null);
        hostHeader.set(null);
        responseBody = EMPTY_LIST_BODY;

        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            URI requestUri = exchange.getRequestURI();
            // getRawPath/getRawQuery 是「线上字节」，不能解码后再断言（解码会抹平 %25 痕迹）。
            rawPath.set(requestUri.getRawPath());
            rawQuery.set(requestUri.getRawQuery());
            method.set(exchange.getRequestMethod());
            hostHeader.set(exchange.getRequestHeaders().getFirst("Host"));
            byte[] body = responseBody.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", MediaType.APPLICATION_JSON_VALUE);
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(body);
            }
        });
        server.start();

        expectedAuthority = "127.0.0.1:" + server.getAddress().getPort();

        BffProperties properties = new BffProperties();
        properties.setSystemDiscoveryEnabled(false);
        properties.setSystemBaseUrl("http://" + expectedAuthority);
        properties.setAggregateTimeoutMs(5000);

        client = new SystemWebClient(WebClient.builder(), WebClient.builder(), properties);
    }

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    /** 核对路径原样送达、Host 指向 baseUrl 主机、查询串无二次编码指纹。 */
    private void assertHitsDownstream(String expectedPath) {
        assertEquals(expectedPath, rawPath.get(),
                "路径必须原样送达（含路径变量展开），且 baseUrl 已正确拼接");
        assertEquals(expectedAuthority, hostHeader.get(),
                "Host 必须是 baseUrl 指定的主机 —— 若有人改用 uri(URI) 传相对地址，baseUrl 会被丢弃");
        String query = rawQuery.get();
        if (query != null) {
            assertFalse(query.contains("%25"),
                    () -> "查询串出现 %25（双重编码回归）：" + query);
        }
    }

    @Test
    @DisplayName("moduleApiTree(5) → GET /internal/v1/modules/5/apis，路径变量正确展开")
    void moduleApiTreeExpandsPathVariable() {
        List<?> data = client.moduleApiTree(5L);

        assertNotNull(data);
        assertEquals("GET", method.get());
        assertHitsDownstream("/internal/v1/modules/5/apis");
    }

    @Test
    @DisplayName("moduleBindings(8) → GET /internal/v1/modules/8/bindings")
    void moduleBindingsExpandsPathVariable() {
        assertNotNull(client.moduleBindings(8L));

        assertEquals("GET", method.get());
        assertHitsDownstream("/internal/v1/modules/8/bindings");
    }

    @Test
    @DisplayName("menuApiList(7) → GET /internal/v1/menus/7/apis")
    void menuApiListExpandsPathVariable() {
        assertNotNull(client.menuApiList(7L));

        assertEquals("GET", method.get());
        assertHitsDownstream("/internal/v1/menus/7/apis");
    }

    @Test
    @DisplayName("menuApiReplace(9, body) → PUT /internal/v1/menus/9/apis")
    void menuApiReplaceExpandsPathVariable() {
        responseBody = VOID_BODY;

        client.menuApiReplace(9L, Map.of("apiIds", List.of(1, 2, 3)));

        assertEquals("PUT", method.get());
        assertHitsDownstream("/internal/v1/menus/9/apis");
    }
}
