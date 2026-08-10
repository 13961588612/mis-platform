package com.mis.adminbff.client;

import com.mis.adminbff.config.BffProperties;
import com.mis.common.core.result.PageResult;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.client.WebClient;
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
 * {@code IamWebClient.pageUsers()} 的查询串编码回归测试 —— 守护 DEF-02
 * 「用户名含中文/空格时用户列表接口 500」的修复。
 *
 * <h2>缺陷回放</h2>
 * 旧实现是：
 * <pre>
 *   String uri = UriComponentsBuilder.fromPath("/internal/v1/users")
 *           ...queryParamIfPresent("username", Optional.of("张伟"))
 *           .build(true)          // ← 声明「这段字符串已经编码好了」
 *           .toUriString();
 *   client().get().uri(uri)...
 * </pre>
 * {@code build(true)} 会触发 {@code HierarchicalUriComponents.verify()} 逐字符校验，
 * 未编码的「张」立刻抛
 * {@code IllegalArgumentException: Invalid character '张' for QUERY_PARAM}，接口 500。
 *
 * <p>关键在于<b>「只把 build(true) 改成 build()」并不能修好</b>：那样得到的是一段
 * 已百分号编码的字符串，交给 {@code uri(String)} 后会被
 * {@code DefaultUriBuilderFactory}（默认 {@code TEMPLATE_AND_VALUES}）再编码一次，
 * {@code %E5%BC%A0} → {@code %25E5%25BC%25A0} —— 不再 500，但下游解码后拿到乱码，
 * 变成「搜中文永远搜不到」的静默故障，也就是 DEF-01 的原样重演。
 * {@link RootCauseFossil} 把这两条歧路都固化成用例。
 *
 * <h2>为什么用真实 {@link HttpServer} 而不是 Mock</h2>
 * 证据只存在于<b>真实发出的那一行 HTTP 请求</b>里：编码发生在 WebClient 内部，
 * 任何在 URI 定型之前截走请求的 Mock 都测不到它。这里让真实 {@link WebClient}
 * 打到本地 {@link HttpServer}，再用 {@code exchange.getRequestURI().getRawQuery()}
 * 取<b>未解码</b>的原始查询串做断言 —— 拿到的就是 mis-iam 会看到的字节。
 * 写法与同目录 {@code KbWebClientUriEncodingTest} 一致（本仓库未引 MockWebServer）。
 *
 * <p>装配方式也与 {@code KbWebClientUriEncodingTest} 对齐：直接 new 出被测客户端并让它
 * 走自己的 {@code buildClient()}，baseUrl 由 {@link BffProperties} 决定。
 * 这比 {@code @SpringBootTest} 更贴近本次要守的东西（客户端自身的 URI 装配），
 * 且不必为一条编码断言拉起整个上下文（Redis/Nacos 依赖）。
 */
class IamWebClientEncodingTest {

    /** 下游返回空分页。 */
    private static final String EMPTY_PAGE_BODY =
            "{\"code\":0,\"message\":\"ok\",\"data\":{\"page\":1,\"size\":10,\"total\":0,\"list\":[]}}";

    private HttpServer server;
    private IamWebClient client;

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
            // 而二次编码的痕迹恰好在解码后被抹平成看似正常的 %E5...，测了等于没测。
            rawPath.set(requestUri.getRawPath());
            rawQuery.set(requestUri.getRawQuery());
            hostHeader.set(exchange.getRequestHeaders().getFirst("Host"));
            byte[] body = EMPTY_PAGE_BODY.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", MediaType.APPLICATION_JSON_VALUE);
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(body);
            }
        });
        server.start();

        expectedAuthority = "127.0.0.1:" + server.getAddress().getPort();

        BffProperties properties = new BffProperties();
        properties.setIamDiscoveryEnabled(false);
        properties.setIamBaseUrl("http://" + expectedAuthority);
        properties.setAggregateTimeoutMs(5000);

        // 与生产装配同构：走 IamWebClient 自己的 buildClient()，baseUrl 由 BffProperties 决定。
        client = new IamWebClient(WebClient.builder(), WebClient.builder(), properties);
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
                () -> "查询串里出现 %25，说明已编码字符串又被 WebClient 编码了一次（DEF-01/DEF-02 回归）：" + query);
    }

    /** 寻址护栏：请求必须打在 baseUrl 指定的主机上，路径原样送达。 */
    private void assertHitsFakeIam() {
        assertEquals("/internal/v1/users", rawPath.get(),
                "路径必须原样送达，且 baseUrl 已正确拼接（说明请求真的打到了假 mis-iam 而非默认主机）");
        assertEquals(expectedAuthority, hostHeader.get(),
                "Host 头必须是 baseUrl 指定的主机 —— 若有人改用 uri(URI) 传相对路径，"
                        + "baseUrl 会被丢弃，请求静默打到别处，服务发现也会一并失效");
    }

    /** 取某个查询参数的原始（未解码）值。 */
    private String rawValueOf(String name) {
        return splitRaw(rawQuery.get()).get(name);
    }

    /** 取某个查询参数解码后的值 —— 这就是下游 mis-iam 实际拿到的用户名。 */
    private String decodedValueOf(String name) {
        String raw = rawValueOf(name);
        return raw == null ? null : URLDecoder.decode(raw, StandardCharsets.UTF_8);
    }

    @Nested
    @DisplayName("DEF-02 主场景：中文 / 空格用户名不再 500，且只编码一次")
    class SingleEncoding {

        @Test
        @DisplayName("「张伟 测试」不抛异常、请求命中假 mis-iam、解码后还原成原文")
        void chineseAndSpacedUsernameSurvives() {
            PageResult<?> page = assertDoesNotThrow(
                    () -> client.pageUsers(1L, 2L, null, "张伟 测试", null, 1, 10),
                    "修复前这里抛 IllegalArgumentException: Invalid character '张' for QUERY_PARAM");

            assertNotNull(page);
            assertHitsFakeIam();
            assertNoDoubleEncoding();
            assertEquals("%E5%BC%A0%E4%BC%9F%20%E6%B5%8B%E8%AF%95", rawValueOf("username"),
                    "只编码一次的期望字节；出现 %25 就是又叠了一层");
            assertEquals("张伟 测试", decodedValueOf("username"),
                    "下游解码后必须还原成用户输入的原文，否则模糊匹配必然 0 行");
        }

        @Test
        @DisplayName("纯 ASCII「alpha」保持原样 —— 修复不能把本来正常的路径改坏")
        void plainAsciiUsernameUnchanged() {
            client.pageUsers(1L, 2L, null, "alpha", null, 1, 10);

            assertHitsFakeIam();
            assertNoDoubleEncoding();
            assertEquals("alpha", rawValueOf("username"),
                    "这条在修复前后都应通过；它在这里是为了证明修复没有引入新的转义");
        }

        @Test
        @DisplayName("其余参数（tenantId/appId/page/size）原样送达，顺序与旧实现一致")
        void otherParamsUnaffected() {
            client.pageUsers(1L, 2L, 1, "张伟", 9L, 3, 20);

            assertHitsFakeIam();
            assertNoDoubleEncoding();
            assertEquals("1", rawValueOf("tenantId"));
            assertEquals("2", rawValueOf("appId"));
            assertEquals("3", rawValueOf("page"));
            assertEquals("20", rawValueOf("size"));
            assertEquals("1", rawValueOf("status"));
            assertEquals("9", rawValueOf("deptId"));
            assertEquals("张伟", decodedValueOf("username"));
            assertEquals("tenantId=1&appId=2&page=3&size=20&status=1"
                            + "&username=%E5%BC%A0%E4%BC%9F&deptId=9",
                    rawQuery.get(),
                    "参数顺序与旧实现保持一致，便于下游日志/缓存键对齐");
        }
    }

    @Nested
    @DisplayName("参数值是数据，不是结构")
    class ValuesAreData {

        @Test
        @DisplayName("值里的 & 与 = 被整体编码，不会劈成多个查询参数")
        void reservedCharactersDoNotSplitQuery() {
            client.pageUsers(1L, 2L, null, "A&B=C", null, 1, 10);

            assertNoDoubleEncoding();
            Map<String, String> parsed = splitRaw(rawQuery.get());
            assertEquals(5, parsed.size(),
                    () -> "应当只有 tenantId/appId/page/size/username 五个参数：" + rawQuery.get());
            assertEquals("A&B=C", decodedValueOf("username"));
        }

        @Test
        @DisplayName("值里的花括号被当成普通字符，不会被误解析成 URI 模板变量")
        void bracesAreNotTreatedAsUriTemplate() {
            // username 走 {username} 占位 + build(Map) 展开，用户输入里的花括号因此进不了模板层。
            // 若改成把原文直接 queryParam() 进去，这里会抛 IllegalArgumentException（变量值不足）。
            assertDoesNotThrow(() -> client.pageUsers(1L, 2L, null, "张{伟}", null, 1, 10));

            assertNoDoubleEncoding();
            assertEquals("张{伟}", decodedValueOf("username"));
        }

        @Test
        @DisplayName("值里已有的百分号被正确转义成 %25，且不会再叠一层")
        void literalPercentIsEscapedOnce() {
            client.pageUsers(1L, 2L, null, "100%", null, 1, 10);

            // 这是唯一允许出现 %25 的场景：用户真的输入了 %。
            assertEquals("100%25", rawValueOf("username"));
            assertEquals("100%", decodedValueOf("username"),
                    "解码后必须还原成 100%，出现 %2525 就是又叠了一层");
        }
    }

    @Nested
    @DisplayName("既有筛选语义保持不变")
    class FilteringSemanticsPreserved {

        @Test
        @DisplayName("username 为 null 时不出现在查询串里")
        void nullUsernameIsSkipped() {
            client.pageUsers(1L, 2L, null, null, null, 1, 10);

            assertHitsFakeIam();
            assertNull(rawValueOf("username"), () -> "「没传」不能变成「传了空值」：" + rawQuery.get());
            assertEquals("tenantId=1&appId=2&page=1&size=10", rawQuery.get());
        }

        @Test
        @DisplayName("username 为纯空格时同样视为「没传」（沿用旧的 isBlank 过滤）")
        void blankUsernameIsSkipped() {
            client.pageUsers(1L, 2L, null, "   ", null, 1, 10);

            assertHitsFakeIam();
            assertNull(rawValueOf("username"),
                    () -> "空白用户名应被过滤掉，否则下游会按「用户名等于三个空格」去匹配：" + rawQuery.get());
            assertEquals("tenantId=1&appId=2&page=1&size=10", rawQuery.get());
        }

        @Test
        @DisplayName("status/deptId 为 null 时不出现在查询串里")
        void nullOptionalFiltersAreSkipped() {
            client.pageUsers(1L, 2L, null, "alpha", null, 1, 10);

            Map<String, String> parsed = splitRaw(rawQuery.get());
            assertNull(parsed.get("status"));
            assertNull(parsed.get("deptId"));
        }
    }

    /**
     * 根因固化：把「为什么不能改回去」的两条歧路各钉一颗钉子。
     *
     * <p>这两条用例不依赖被测代码，它们描述的是 Spring URI 工具链本身的行为 ——
     * 正因为不依赖，它们才能在被测代码被改坏之后，依然清楚地解释「错在哪」。
     */
    @Nested
    @DisplayName("根因固化：build(true) 抛异常，build()+uri(String) 二次编码")
    class RootCauseFossil {

        @Test
        @DisplayName("歧路一：build(true) 遇到未编码中文直接抛 IllegalArgumentException（= 旧实现的 500）")
        void buildTrueRejectsRawChinese() {
            IllegalArgumentException ex = assertThrows(IllegalArgumentException.class, () ->
                    UriComponentsBuilder.fromPath("/internal/v1/users")
                            .queryParam("username", "张伟")
                            .build(true)
                            .toUriString());

            assertTrue(ex.getMessage().contains("Invalid character"),
                    () -> "预期是 verify() 的字符校验失败，实际：" + ex.getMessage());
        }

        @Test
        @DisplayName("歧路二：build()+encode() 的产物再过一次 uri(String)，%E5 变成 %25E5")
        void preEncodedStringGetsEncodedTwice() {
            String preEncoded = UriComponentsBuilder.fromPath("/internal/v1/users")
                    .queryParam("username", "张伟")
                    .build()
                    .encode()
                    .toUriString();
            assertTrue(preEncoded.contains("username=%E5%BC%A0%E4%BC%9F"),
                    "预编码串本身是对的，问题出在它之后又被编码了一次");

            // uri(String) 内部就是这个 factory（默认 EncodingMode.TEMPLATE_AND_VALUES）
            URI doubled = new org.springframework.web.util.DefaultUriBuilderFactory("http://127.0.0.1:8102")
                    .expand(preEncoded);

            assertTrue(doubled.toString().contains("username=%25E5%25BC%25A0%25E4%25BC%259F"),
                    () -> "这就是 DEF-01 的根因；只把 build(true) 换成 build() 会掉进这里。实际：" + doubled);
        }

        @Test
        @DisplayName("歧路三：相对 URI 没有 scheme/host —— uri(URI) 会静默丢掉 baseUrl")
        void relativeUriCarriesNoHost() {
            URI relative = URI.create(UriComponentsBuilder.fromPath("/internal/v1/users")
                    .queryParam("username", "张伟")
                    .build()
                    .encode()
                    .toUriString());

            assertFalse(relative.isAbsolute(), "相对 URI 交给 uri(URI) 后，请求将没有目标主机");
            assertNull(relative.getHost());
            assertNull(relative.getScheme());
        }
    }
}
