package com.mis.auth.client;

import com.mis.auth.config.AuthProperties;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.DefaultUriBuilderFactory;
import org.springframework.web.util.UriComponentsBuilder;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@code IamUserClient.findByUsername()} 的查询串编码回归测试 —— 守护 C-1
 * 「中文用户名登录直接 500」的修复。与 DEF-01（KbWebClient）、DEF-02（IamWebClient）同源。
 *
 * <h2>缺陷回放</h2>
 * 旧实现是 {@code UriComponentsBuilder...queryParam("username", username).build(true).toUriString()}
 * 再交给 {@code restClient.get().uri(String)}。{@code build(true)} 断言「这段字符串已经编码好了」，
 * 于是 {@code HierarchicalUriComponents.verify()} 逐字符校验，未编码的「张」立刻抛
 * {@code IllegalArgumentException: Invalid character '张' for QUERY_PARAM} —— 登录接口 500。
 *
 * <p>注意<b>不能只把 {@code build(true)} 改成 {@code build()}</b>：那样得到一段已百分号编码的
 * 字符串，{@code RestClient.uri(String)} 背后的 {@code DefaultUriBuilderFactory}
 * （默认 {@code TEMPLATE_AND_VALUES}）会把它再编码一次，
 * {@code %E5%BC%A0} → {@code %25E5%25BC%25A0}，登录从「500」退化成「用户永远查不到」。
 * {@link RootCauseFossil} 把这两条歧路都固化下来。
 *
 * <h2>为什么用真实 {@link HttpServer}</h2>
 * 编码发生在 {@code RestClient} 内部，只有真实发出的那一行 HTTP 请求才是证据。
 * 这里让真实 {@link RestClient} 打到本地 {@link HttpServer}，用
 * {@code exchange.getRequestURI().getRawQuery()} 取<b>未解码</b>的原始查询串做断言。
 * 写法与 mis-admin-bff 的 {@code KbWebClientUriEncodingTest} 保持一致
 * （本仓库未引 MockWebServer，JDK 自带 {@link HttpServer} 足够且不新增依赖）。
 *
 * <p>{@link IamUserClient} 直接 new 出来并让它自己 {@code baseUrl(resolveBaseUrl(props))}，
 * 与生产装配同构；不用 {@code @SpringBootTest} 是因为本模块的完整上下文需要
 * PostgreSQL/Redis，而本测试要守的只是客户端自身的 URI 装配。
 */
class IamUserClientEncodingTest {

    /** 下游返回一个最小可反序列化的 AuthUserVO。 */
    private static final String AUTH_USER_BODY = """
            {"code":0,"message":"ok","data":{
              "id":"10","tenantId":"1","appId":"2","employeeId":"100",
              "username":"张伟","passwordHash":"{bcrypt}x","status":1,
              "isTenantAdmin":0,"mustChangePassword":0,"permVersion":1,
              "roleCodes":[],"realName":"张伟","deptId":"5"}}
            """;

    private HttpServer server;
    private IamUserClient client;

    private final AtomicReference<String> rawPath = new AtomicReference<>();
    private final AtomicReference<String> rawQuery = new AtomicReference<>();
    private final AtomicReference<String> hostHeader = new AtomicReference<>();

    /** 本轮假 mis-iam 的 {@code host:port}，用于核对请求确实打在 baseUrl 指定的主机上。 */
    private String expectedAuthority = "";

    @BeforeEach
    void setUp() throws IOException {
        rawPath.set(null);
        rawQuery.set(null);
        hostHeader.set(null);

        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            URI requestUri = exchange.getRequestURI();
            // 必须用 getRawPath/getRawQuery：getPath/getQuery 会解码，
            // 二次编码的痕迹恰好在解码后被抹平成看似正常的 %E5...。
            rawPath.set(requestUri.getRawPath());
            rawQuery.set(requestUri.getRawQuery());
            hostHeader.set(exchange.getRequestHeaders().getFirst("Host"));
            byte[] body = AUTH_USER_BODY.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(body);
            }
        });
        server.start();

        expectedAuthority = "127.0.0.1:" + server.getAddress().getPort();

        AuthProperties properties = new AuthProperties();
        properties.setIamDiscoveryEnabled(false);
        properties.setIamBaseUrl("http://" + expectedAuthority);

        // 与生产装配同构：IamUserClient 自己 baseUrl(...).build()
        client = new IamUserClient(RestClient.builder(), RestClient.builder(), properties);
    }

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    // ------------------------------------------------------------------ 辅助

    /** 把原始查询串按 {@code &} / {@code =} 切开，值保持<b>未解码</b>原样。 */
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

    /** 核心断言：原始查询串中不得出现 {@code %25} —— 那是「% 又被编码了一次」的指纹。 */
    private void assertNoDoubleEncoding() {
        String query = rawQuery.get();
        assertNotNull(query, "下游必须真的收到了带查询串的请求");
        assertFalse(query.contains("%25"),
                () -> "查询串里出现 %25，说明已编码字符串又被 RestClient 编码了一次（C-1 回归）：" + query);
    }

    /** 寻址护栏：请求必须打在 baseUrl 指定的主机上。 */
    private void assertHitsFakeIam(String expectedPath) {
        assertEquals(expectedPath, rawPath.get(),
                "路径必须原样送达，且 baseUrl 已正确拼接（说明请求真的打到了假 mis-iam）");
        assertEquals(expectedAuthority, hostHeader.get(),
                "Host 头必须是 baseUrl 指定的主机 —— RestClient 的 uri(Function) 用的是携带 baseUrl 的 "
                        + "uriBuilderFactory，拼出的必须是绝对 URI；丢了 host 服务发现也会失效");
    }

    private String rawValueOf(String name) {
        return splitRaw(rawQuery.get()).get(name);
    }

    private String decodedValueOf(String name) {
        String raw = rawValueOf(name);
        return raw == null ? null : URLDecoder.decode(raw, StandardCharsets.UTF_8);
    }

    @Nested
    @DisplayName("C-1 主场景：中文用户名登录不再 500，且只编码一次")
    class SingleEncoding {

        @Test
        @DisplayName("「张伟」不抛异常、请求命中假 mis-iam、解码后还原成原文")
        void chineseUsernameSurvives() {
            IamUserClient.AuthUserPayload payload = assertDoesNotThrow(
                    () -> client.findByUsername(1L, 2L, "张伟"),
                    "修复前这里抛 IllegalArgumentException: Invalid character '张' for QUERY_PARAM");

            assertNotNull(payload, "下游返回了用户，说明请求真的发出去并被正确反序列化");
            assertEquals("张伟", payload.username());
            assertHitsFakeIam("/internal/v1/users/by-username");
            assertNoDoubleEncoding();
            assertEquals("%E5%BC%A0%E4%BC%9F", rawValueOf("username"),
                    "只编码一次的期望字节；修复前若退化成 build() + uri(String) 这里会是 %25E5%25BC%25A0%25E4%25BC%259F");
            assertEquals("张伟", decodedValueOf("username"),
                    "下游解码后必须还原成原文，否则按用户名查不到人，登录失败");
        }

        @Test
        @DisplayName("含空格的用户名「张伟 测试」同样只编码一次")
        void spacedUsernameSurvives() {
            assertDoesNotThrow(() -> client.findByUsername(1L, 2L, "张伟 测试"));

            assertNoDoubleEncoding();
            assertEquals("%E5%BC%A0%E4%BC%9F%20%E6%B5%8B%E8%AF%95", rawValueOf("username"));
            assertEquals("张伟 测试", decodedValueOf("username"));
        }

        @Test
        @DisplayName("纯 ASCII「admin」保持原样 —— 修复不能把本来正常的登录改坏")
        void plainAsciiUsernameUnchanged() {
            client.findByUsername(1L, 2L, "admin");

            assertHitsFakeIam("/internal/v1/users/by-username");
            assertNoDoubleEncoding();
            assertEquals("admin", rawValueOf("username"));
            assertEquals("tenantId=1&appId=2&username=admin", rawQuery.get(),
                    "参数与顺序都与旧实现一致");
        }

        @Test
        @DisplayName("tenantId / appId 原样送达")
        void scopeParamsUnaffected() {
            client.findByUsername(7L, 8L, "张伟");

            assertEquals("7", rawValueOf("tenantId"));
            assertEquals("8", rawValueOf("appId"));
        }
    }

    @Nested
    @DisplayName("参数值是数据，不是结构")
    class ValuesAreData {

        @Test
        @DisplayName("值里的 & 与 = 被整体编码，不会劈成多个查询参数")
        void reservedCharactersDoNotSplitQuery() {
            client.findByUsername(1L, 2L, "A&B=C");

            assertNoDoubleEncoding();
            assertEquals(3, splitRaw(rawQuery.get()).size(),
                    () -> "应当只有 tenantId/appId/username 三个参数：" + rawQuery.get());
            assertEquals("A&B=C", decodedValueOf("username"));
        }

        @Test
        @DisplayName("值里的花括号被当成普通字符，不会被误解析成 URI 模板变量")
        void bracesAreNotTreatedAsUriTemplate() {
            assertDoesNotThrow(() -> client.findByUsername(1L, 2L, "张{伟}"));

            assertNoDoubleEncoding();
            assertEquals("张{伟}", decodedValueOf("username"));
        }

        @Test
        @DisplayName("值里已有的百分号被正确转义成 %25，且不会再叠一层")
        void literalPercentIsEscapedOnce() {
            client.findByUsername(1L, 2L, "100%");

            assertEquals("100%25", rawValueOf("username"));
            assertEquals("100%", decodedValueOf("username"));
        }
    }

    @Nested
    @DisplayName("同一 getAuthUser 通道上的另一个调用点未被改坏")
    class SiblingCallSitePreserved {

        @Test
        @DisplayName("findById 仍按 /internal/v1/users/{id}/auth 寻址，且无查询串")
        void findByIdStillWorks() {
            IamUserClient.AuthUserPayload payload = client.findById(10L);

            assertNotNull(payload);
            assertHitsFakeIam("/internal/v1/users/10/auth");
            assertNull(rawQuery.get(), "该端点本就没有查询参数，不应凭空多出一个 '?'");
        }
    }

    /**
     * 根因固化：把「为什么不能改回去」的两条歧路各钉一颗钉子。
     * 这两条用例只描述 Spring URI 工具链自身的行为，因此能在被测代码被改坏后依然解释「错在哪」。
     */
    @Nested
    @DisplayName("根因固化：build(true) 抛异常，build()+uri(String) 二次编码")
    class RootCauseFossil {

        @Test
        @DisplayName("歧路一：build(true) 遇到未编码中文直接抛 IllegalArgumentException（= 旧实现的 500）")
        void buildTrueRejectsRawChinese() {
            IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () ->
                    UriComponentsBuilder.fromPath("/internal/v1/users/by-username")
                            .queryParam("username", "张伟")
                            .build(true)
                            .toUriString());

            assertTrue(ex.getMessage().contains("Invalid character"),
                    () -> "预期是 verify() 的字符校验失败，实际：" + ex.getMessage());
        }

        @Test
        @DisplayName("歧路二：build()+encode() 的产物再过一次 uri(String)，%E5 变成 %25E5")
        void preEncodedStringGetsEncodedTwice() {
            String preEncoded = UriComponentsBuilder.fromPath("/internal/v1/users/by-username")
                    .queryParam("username", "张伟")
                    .build()
                    .encode()
                    .toUriString();
            assertTrue(preEncoded.contains("username=%E5%BC%A0%E4%BC%9F"));

            // RestClient.uri(String) 内部就是这个 factory（默认 EncodingMode.TEMPLATE_AND_VALUES）
            URI doubled = new DefaultUriBuilderFactory("http://127.0.0.1:8102").expand(preEncoded);

            assertTrue(doubled.toString().contains("username=%25E5%25BC%25A0%25E4%25BC%259F"),
                    () -> "只把 build(true) 换成 build() 会掉进这里。实际：" + doubled);
        }

        @Test
        @DisplayName("歧路三：相对 URI 没有 scheme/host —— 直接把它当最终地址会丢 baseUrl")
        void relativeUriCarriesNoHost() {
            URI relative = URI.create(UriComponentsBuilder.fromPath("/internal/v1/users/by-username")
                    .queryParam("username", "张伟")
                    .build()
                    .encode()
                    .toUriString());

            assertFalse(relative.isAbsolute());
            assertNull(relative.getHost());
            assertNull(relative.getScheme());
        }
    }
}
