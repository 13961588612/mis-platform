package com.mis.adminbff.client;

import com.mis.adminbff.config.BffProperties;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.DefaultUriBuilderFactory;
import org.springframework.web.util.UriBuilder;

import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@code AbstractDownstreamClient.queryUri()} 的回归测试（T3 收口，2026-08-12）。
 *
 * <p>背景：DEF-01/DEF-02/C-1 已验证「{@code uri(Function<UriBuilder, URI>)} 让查询串
 * 只编码一次」是唯一正确范式，但修复只覆盖了 2 处用户可控参数；剩余 19 处
 * {@code .build(true).toUriString()} 是「Long/Integer/ID 串」巧合安全。T3 把同一套
 * 语义收口成基类静态方法 {@code queryUri(path, name, value, ...)} 并替换全部调用点。
 *
 * <p>本测试守三层契约（与 {@code KbWebClientUriEncodingTest} 的 AbsoluteAddressing
 * /SingleEncoding 同构）：
 * <ol>
 *   <li><b>寻址</b>——产出带 baseUrl 的绝对 URI（host=服务名，LoadBalancer 可解析）；</li>
 *   <li><b>单次编码</b>——中文/空格/保留字符只编码一次，原始查询串无 {@code %25} 指纹；</li>
 *   <li><b>过滤语义</b>——{@code null} 与空白值一律跳过（「没传」≠「传了空值」）。</li>
 * </ol>
 */
class DownstreamClientQueryUriTest {

    private static final String BASE = "http://mis-system.internal:8300";

    /** 反射取出 {@code queryUri} 的产物（返回类型必须是 Function，改回 String 会 ClassCastException）。 */
    @SuppressWarnings("unchecked")
    private static Function<UriBuilder, URI> invokeQueryUri(String path, Object... nameValuePairs) {
        try {
            Method method = AbstractDownstreamClient.class.getDeclaredMethod(
                    "queryUri", String.class, Object[].class);
            method.setAccessible(true);
            return (Function<UriBuilder, URI>) method.invoke(null, path, (Object) nameValuePairs);
        } catch (ReflectiveOperationException ex) {
            throw new AssertionError("queryUri(String, Object...) 签名已变更，请同步本测试", ex);
        }
    }

    private static URI apply(String path, Object... nameValuePairs) {
        return invokeQueryUri(path, nameValuePairs)
                .apply(new DefaultUriBuilderFactory(BASE).builder());
    }

    @Nested
    @DisplayName("寻址护栏：必须拼出带 baseUrl 的绝对地址")
    class AbsoluteAddressing {

        @Test
        @DisplayName("带 baseUrl 的 UriBuilder 展开后是绝对 URI，path 原样")
        void producesAbsoluteUri() {
            URI uri = apply("/internal/v1/orgs", "tenantId", 1L);

            assertTrue(uri.isAbsolute(), () -> "必须是绝对 URI：" + uri);
            assertEquals("http", uri.getScheme());
            assertEquals("mis-system.internal", uri.getHost());
            assertEquals(8300, uri.getPort());
            assertEquals("/internal/v1/orgs", uri.getRawPath());
            assertEquals("tenantId=1", uri.getRawQuery());
        }

        @Test
        @DisplayName("服务发现模式：host 保留服务名，LoadBalancer 可解析")
        void keepsServiceIdHost() {
            URI uri = invokeQueryUri("/internal/v1/menus/tree", "appId", 2L)
                    .apply(new DefaultUriBuilderFactory("http://mis-system").builder());

            assertEquals("mis-system", uri.getHost());
        }
    }

    @Nested
    @DisplayName("单次编码：中文 / 空格 / 保留字符只编码一次")
    class SingleEncoding {

        @Test
        @DisplayName("中文参数 → 只编码一次，无 %25 指纹")
        void chineseValueEncodedOnce() {
            URI uri = apply("/internal/v1/apps", "kind", "子系统");

            assertEquals("kind=%E5%AD%90%E7%B3%BB%E7%BB%9F", uri.getRawQuery(),
                    () -> "出现 %25 就是二次编码（DEF-01 回归），实际：" + uri.getRawQuery());
            assertEquals("子系统", URLDecoder.decode(uri.getRawQuery().split("=", 2)[1], StandardCharsets.UTF_8));
        }

        @Test
        @DisplayName("值里的 & = 花括号 被整体编码成数据，不劈查询串、不误解析模板")
        void reservedCharsAreData() {
            URI uri = apply("/internal/v1/search", "q", "A&B={x}");

            assertFalse(uri.getRawQuery().contains("&B="),
                    () -> "& 必须被编码，否则查询串被劈开：" + uri.getRawQuery());
            assertFalse(uri.getRawQuery().contains("{x}"),
                    () -> "花括号必须被编码，否则会被当成模板变量：" + uri.getRawQuery());
            String decoded = URLDecoder.decode(uri.getRawQuery().split("=", 2)[1], StandardCharsets.UTF_8);
            assertEquals("A&B={x}", decoded);
        }

        @Test
        @DisplayName("纯 ASCII 数字串保持原样（menuIds=1,2,3 语义不变）")
        void numericCommaListSurvives() {
            URI uri = apply("/internal/v1/menus/permissions", "menuIds", "1,2,3");

            assertEquals("1,2,3", URLDecoder.decode(uri.getRawQuery().split("=", 2)[1], StandardCharsets.UTF_8),
                    "逗号串解码后必须还原，下游按 getParameter 取值语义不变");
        }
    }

    @Nested
    @DisplayName("过滤语义：null 与空白值一律跳过")
    class SkipSemantics {

        @Test
        @DisplayName("null 值不出现；空白串不出现；只保留有效参数")
        void nullAndBlankSkipped() {
            URI uri = apply("/internal/v1/kb/libraries", "categoryId", null, "kind", "   ", "page", 1);

            assertEquals("page=1", uri.getRawQuery(),
                    () -> "「没传」不能变成「传了空值」，实际：" + uri.getRawQuery());
        }

        @Test
        @DisplayName("无有效参数 → 只有 path，不产生尾随 ?")
        void noParamsProducesNoQueryString() {
            URI uri = apply("/internal/v1/stats/users", "tenantId", null);

            assertEquals("/internal/v1/stats/users", uri.getRawPath());
            assertNull(uri.getRawQuery());
        }
    }

    /**
     * 端到端接线验证：真实 {@link WebClient}（经 {@code SystemWebClient.tree}）打到
     * 本地 {@link HttpServer}，确认 {@code queryUri} 的产物真的被 {@code uri(Function)}
     * 消费且只编码一次。
     */
    @Nested
    @DisplayName("端到端：queryUri 产物经真实 WebClient 只编码一次")
    class EndToEnd {

        private HttpServer server;
        private final AtomicReference<String> rawQuery = new AtomicReference<>();
        private String expectedAuthority = "";

        @BeforeEach
        void setUp() throws IOException {
            rawQuery.set(null);
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", exchange -> {
                rawQuery.set(exchange.getRequestURI().getRawQuery());
                byte[] body = "{\"code\":0,\"message\":\"ok\",\"data\":[]}".getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", MediaType.APPLICATION_JSON_VALUE);
                exchange.sendResponseHeaders(200, body.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(body);
                }
            });
            server.start();
            expectedAuthority = "127.0.0.1:" + server.getAddress().getPort();
        }

        @AfterEach
        void tearDown() {
            if (server != null) {
                server.stop(0);
            }
        }

        @Test
        @DisplayName("SystemWebClient.tree(appId) → 原始查询串 appId=N，无 %25，请求命中假下游")
        void realClientHitsFakeDownstream() {
            BffProperties properties = new BffProperties();
            properties.setSystemDiscoveryEnabled(false);
            properties.setSystemBaseUrl("http://" + expectedAuthority);
            properties.setAggregateTimeoutMs(5000);
            SystemWebClient client = new SystemWebClient(WebClient.builder(), WebClient.builder(), properties);

            List<?> result = client.tree(7L);

            assertNotNull(result);
            assertEquals("appId=7", rawQuery.get());
            assertFalse(rawQuery.get().contains("%25"),
                    () -> "查询串出现 %25 = 二次编码（DEF-01 回归）：" + rawQuery.get());
        }
    }
}
