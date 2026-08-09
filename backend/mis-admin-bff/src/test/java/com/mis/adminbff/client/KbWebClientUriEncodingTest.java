package com.mis.adminbff.client;

import com.mis.adminbff.config.BffProperties;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.DefaultUriBuilderFactory;
import org.springframework.web.util.UriBuilder;
import org.springframework.web.util.UriComponentsBuilder;

import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
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
 * {@code KbWebClient.buildUri()} 的查询串编码回归测试 —— 直接守护 DEF-01
 * 「经 BFF 检索时，含中文或空格的关键词一律命中 0 行」的修复。
 *
 * <h2>缺陷回放</h2>
 * 旧实现里 {@code buildUri()} 返回一段<b>已经百分号编码</b>的字符串
 * （{@code keyword=%E5%AD%A3%E5%BA%A6}），六个调用点把它交给
 * {@code WebClient.uri(String)}。该重载走 {@code DefaultUriBuilderFactory}，
 * 默认编码模式 {@code TEMPLATE_AND_VALUES} 会把整段模板<b>再编码一次</b>，
 * {@code %} 被转义成 {@code %25}：
 * <pre>
 *   季度        → %E5%AD%A3%E5%BA%A6 → %25E5%25AD%25A3%25E5%25BA%25A6
 *   Alpha Beta  → Alpha%20Beta       → Alpha%2520Beta
 *   Alpha       → Alpha              → Alpha        （无字符需编码，二次编码是恒等变换）
 * </pre>
 * 下游 mis-kb 解码后拿到的是字面量乱码，于是检索命中 0 行；而纯 ASCII 无空格的
 * 关键词毫发无损 —— 这正是「直连 8108 正常、经 BFF 就 0 行」且「只有中文/空格出事」
 * 的现象来源。{@link RootCauseFossil} 把这个二次编码过程本身固化成用例。
 *
 * <h2>为什么用真实 {@link HttpServer}</h2>
 * 这个缺陷的全部证据都在<b>线上真实发出的那一行 HTTP 请求</b>里。任何 Mock 都可能
 * 在 URI 定型之前就把请求截走，从而测不到 {@code WebClient} 那一层编码。
 * 这里让真实 {@link WebClient} 打真实请求到本地 {@link HttpServer}，
 * 再用 {@code exchange.getRequestURI().getRawQuery()} 取<b>未解码的原始查询串</b>做断言 ——
 * 拿到的就是下游会看到的字节。写法与同目录 {@code AgentOpsTransportAuthHeaderTest} 一致
 * （本模块无 MockWebServer 依赖，JDK 自带 {@code HttpServer} 足够且不新增依赖）。
 *
 * <h2>回归护栏的语义</h2>
 * 只要有人把 {@code buildUri()} 改回「返回已编码字符串 + {@code uri(String)}」，
 * 原始查询串里就会重新出现 {@code %25}，下面每一条 {@code assertNoDoubleEncoding}
 * 都会立刻失败。
 */
class KbWebClientUriEncodingTest {

    /** 下游返回空列表（{@code exportRows} 用）。 */
    private static final String EMPTY_LIST_BODY = "{\"code\":0,\"message\":\"ok\",\"data\":[]}";

    /** 下游返回空分页（{@code listSynonymGroups} / {@code listTickets} 用）。 */
    private static final String EMPTY_PAGE_BODY =
            "{\"code\":0,\"message\":\"ok\",\"data\":{\"page\":1,\"size\":10,\"total\":0,\"list\":[]}}";

    private HttpServer server;
    private KbWebClient client;

    private final AtomicReference<String> rawPath = new AtomicReference<>();
    private final AtomicReference<String> rawQuery = new AtomicReference<>();
    private final AtomicReference<String> hostHeader = new AtomicReference<>();

    /** 本轮假 mis-kb 的 {@code host:port}，用于核对请求确实打在 baseUrl 指定的主机上。 */
    private String expectedAuthority = "";

    /** 由每条用例按被调方法切换的下游响应体。 */
    private volatile String responseBody = EMPTY_LIST_BODY;

    @BeforeEach
    void setUp() throws IOException {
        rawPath.set(null);
        rawQuery.set(null);
        hostHeader.set(null);
        responseBody = EMPTY_LIST_BODY;

        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            URI requestUri = exchange.getRequestURI();
            // getRawPath/getRawQuery 是「线上字节」，绝不能用 getPath/getQuery（会解码，
            // 二次编码的痕迹恰好在解码后被抹平成看似正常的 %E5...，测了等于没测）。
            rawPath.set(requestUri.getRawPath());
            rawQuery.set(requestUri.getRawQuery());
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
        properties.setKbDiscoveryEnabled(false);
        properties.setKbBaseUrl("http://" + expectedAuthority);
        properties.setAggregateTimeoutMs(5000);

        // 与生产装配同构：走 KbWebClient 自己的 buildClient()，baseUrl 由 BffProperties 决定。
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

    /** 核心断言：原始查询串中不得出现 {@code %25}，那是「% 又被编码了一次」的指纹。 */
    private void assertNoDoubleEncoding() {
        String query = rawQuery.get();
        assertNotNull(query, "下游必须真的收到了带查询串的请求");
        assertFalse(query.contains("%25"),
                () -> "查询串里出现 %25，说明已编码字符串又被 WebClient 编码了一次（DEF-01 回归）：" + query);
    }

    /** 取某个查询参数的原始（未解码）值。 */
    private String rawValueOf(String name) {
        return splitRaw(rawQuery.get()).get(name);
    }

    /** 取某个查询参数解码后的值 —— 这就是下游 mis-kb 实际拿到的关键词。 */
    private String decodedValueOf(String name) {
        String raw = rawValueOf(name);
        return raw == null ? null : URLDecoder.decode(raw, StandardCharsets.UTF_8);
    }

    /**
     * 反射取出 {@code KbWebClient.buildUri()} 的产物，用于在<b>不发真实请求</b>的前提下
     * 直接检查它拼出来的 URI 长什么样（见 {@link AbsoluteAddressing}）。
     *
     * <p>用反射是刻意的：{@code buildUri} 是私有实现细节，不值得为了测试提升可见性；
     * 而它的<b>返回类型</b>恰恰是本次修复的核心契约，必须被钉住。
     * 若有人把返回类型改回 {@code String}（或任何非 {@code Function}），
     * 这里的强转会抛 {@link ClassCastException}，测试立刻红 —— 这正是我们要的。
     */
    @SuppressWarnings("unchecked")
    private static Function<UriBuilder, URI> invokeBuildUri(String path, Map<String, Object> params) {
        try {
            Method method = KbWebClient.class.getDeclaredMethod("buildUri", String.class, Map.class);
            method.setAccessible(true);
            return (Function<UriBuilder, URI>) method.invoke(null, path, params);
        } catch (ReflectiveOperationException ex) {
            throw new AssertionError("buildUri(String, Map) 签名已变更，请同步本测试", ex);
        }
    }

    @Nested
    @DisplayName("DEF-01 主场景：中文 / 空格关键词只编码一次")
    class SingleEncoding {

        @Test
        @DisplayName("中文关键词「季度」→ keyword=%E5%AD%A3%E5%BA%A6，不含 %25")
        void chineseKeywordEncodedExactlyOnce() {
            List<?> rows = client.exportRows(new LinkedHashMap<>(Map.of("keyword", "季度")));

            assertNotNull(rows);
            assertEquals("/internal/v1/kb/operations/qa/export", rawPath.get(),
                    "路径必须原样送达，且 baseUrl 已正确拼接（说明请求真的打到了下游而非默认主机）");
            assertEquals(expectedAuthority, hostHeader.get(),
                    "Host 头必须是 baseUrl 指定的主机 —— 若有人改用 uri(URI) 传相对路径，"
                            + "baseUrl 会被丢弃，请求静默打到别处");
            assertNoDoubleEncoding();
            assertEquals("%E5%AD%A3%E5%BA%A6", rawValueOf("keyword"),
                    "修复前这里是 %25E5%25AD%25A3%25E5%25BA%25A6");
            assertEquals("季度", decodedValueOf("keyword"),
                    "下游解码后必须还原成用户输入的原文，否则检索必然 0 行");
        }

        @Test
        @DisplayName("含空格关键词「Alpha Beta」→ keyword=Alpha%20Beta，不含 %25")
        void spacedKeywordEncodedExactlyOnce() {
            client.exportRows(new LinkedHashMap<>(Map.of("keyword", "Alpha Beta")));

            assertNoDoubleEncoding();
            assertEquals("Alpha%20Beta", rawValueOf("keyword"),
                    "修复前这里是 Alpha%2520Beta");
            assertEquals("Alpha Beta", decodedValueOf("keyword"));
        }

        @Test
        @DisplayName("纯 ASCII 无空格「Alpha」保持原样 —— 修复不能把本来正常的路径改坏")
        void plainAsciiKeywordUnchanged() {
            client.exportRows(new LinkedHashMap<>(Map.of("keyword", "Alpha")));

            assertNoDoubleEncoding();
            assertEquals("Alpha", rawValueOf("keyword"),
                    "这条在修复前后都应通过；它在这里是为了证明修复没有引入新的转义");
        }

        @Test
        @DisplayName("术语组列表（走同一个 buildUri）同样只编码一次")
        void synonymListSharesTheFix() {
            responseBody = EMPTY_PAGE_BODY;
            Map<String, Object> params = new LinkedHashMap<>();
            params.put("keyword", "关键结果法");
            params.put("page", 1);
            params.put("size", 10);

            assertNotNull(client.listSynonymGroups(params));

            assertEquals("/internal/v1/kb/synonyms", rawPath.get());
            assertNoDoubleEncoding();
            assertEquals("关键结果法", decodedValueOf("keyword"));
            assertEquals("1", rawValueOf("page"));
            assertEquals("10", rawValueOf("size"));
        }

        @Test
        @DisplayName("多参数混排：中文、空格、数字、ASCII 同时出现互不干扰")
        void mixedParamsAllSurvive() {
            responseBody = EMPTY_PAGE_BODY;
            Map<String, Object> params = new LinkedHashMap<>();
            params.put("keyword", "季度 报表");
            params.put("status", "OPEN");
            params.put("page", 2);
            params.put("size", 20);
            params.put("sort", "createdAt,desc");

            assertNotNull(client.listTickets(params));

            assertEquals("/internal/v1/kb/operations/qa/tickets", rawPath.get());
            assertNoDoubleEncoding();
            assertEquals("季度 报表", decodedValueOf("keyword"));
            assertEquals("OPEN", rawValueOf("status"));
            assertEquals("2", rawValueOf("page"));
            assertEquals("20", rawValueOf("size"));
            assertEquals("createdAt,desc", decodedValueOf("sort"));
        }
    }

    @Nested
    @DisplayName("参数值是数据，不是结构")
    class ValuesAreData {

        @Test
        @DisplayName("值里的 & 与 = 被整体编码，不会劈成多个查询参数")
        void reservedCharactersDoNotSplitQuery() {
            client.exportRows(new LinkedHashMap<>(Map.of("keyword", "A&B=C")));

            assertNoDoubleEncoding();
            Map<String, String> parsed = splitRaw(rawQuery.get());
            assertEquals(1, parsed.size(),
                    () -> "值里的 & 必须被编码成 %26，否则下游会看到额外的查询参数：" + rawQuery.get());
            assertEquals("A&B=C", decodedValueOf("keyword"));
        }

        @Test
        @DisplayName("值里的花括号被当成普通字符，不会被误解析成 URI 模板变量")
        void bracesAreNotTreatedAsUriTemplate() {
            // buildUri 用 {p0} 占位 + build(Map) 展开，用户输入里的花括号因此永远进不了模板层。
            // 若改成把原文直接 queryParam() 进去，这里会抛 IllegalArgumentException（变量值不足）。
            client.exportRows(new LinkedHashMap<>(Map.of("keyword", "{季度}")));

            assertNoDoubleEncoding();
            assertEquals("{季度}", decodedValueOf("keyword"));
        }

        @Test
        @DisplayName("值里已有的百分号被正确转义成 %25，且不会再叠一层")
        void literalPercentIsEscapedOnce() {
            client.exportRows(new LinkedHashMap<>(Map.of("keyword", "100%")));

            // 这一条是唯一允许出现 %25 的场景：用户真的输入了 %。
            assertEquals("100%25", rawValueOf("keyword"));
            assertEquals("100%", decodedValueOf("keyword"),
                    "解码后必须还原成 100%，出现 %2525 就是又叠了一层");
        }
    }

    @Nested
    @DisplayName("既有筛选语义保持不变")
    class FilteringSemanticsPreserved {

        @Test
        @DisplayName("null 与空白值一律不出现在查询串里（「没传」≠「传了空值」）")
        void blankAndNullParamsAreSkipped() {
            Map<String, Object> params = new LinkedHashMap<>();
            params.put("keyword", "季度");
            params.put("from", null);
            params.put("to", "");
            params.put("owner", "   ");

            client.exportRows(params);

            Map<String, String> parsed = splitRaw(rawQuery.get());
            assertEquals(1, parsed.size(), () -> "只应带上 keyword，实际：" + rawQuery.get());
            assertNull(parsed.get("from"));
            assertNull(parsed.get("to"));
            assertNull(parsed.get("owner"));
            assertEquals("季度", decodedValueOf("keyword"));
        }

        @Test
        @DisplayName("params 为空 Map 时只发路径，不产生尾随 ?")
        void emptyParamsProduceNoQueryString() {
            client.exportRows(new HashMap<>());

            assertEquals("/internal/v1/kb/operations/qa/export", rawPath.get());
            assertNull(rawQuery.get(), "空参数不应拼出 '?'，否则下游日志与缓存键都会多一份变体");
        }

        @Test
        @DisplayName("params 为 null 时同样只发路径")
        void nullParamsProduceNoQueryString() {
            client.exportRows(null);

            assertEquals("/internal/v1/kb/operations/qa/export", rawPath.get());
            assertNull(rawQuery.get());
        }
    }

    /**
     * 寻址护栏：拼出来的必须是<b>带 baseUrl 的绝对地址</b>。
     *
     * <p>本组用例守的是与「双重编码」<b>正交</b>的另一条退化路径。修 DEF-01 时最直觉的写法是
     * 让 {@code buildUri} 返回 {@link URI} 并交给 {@code uri(URI)} —— 它确实不再二次编码，
     * 但 {@code DefaultWebClient.initUri()} 对非空 {@code uri} 字段是<b>直接返回</b>、
     * 不经过 {@code uriBuilderFactory}，于是 baseUrl 的 scheme/host/port 被整个丢掉。
     * 相对 URI 不会报错，请求会静默打到默认主机上，同时 {@code @LoadBalanced}
     * 的服务发现也会失效（LB filter 要靠绝对 URI 里的 host 做服务名解析）。
     *
     * <p>那条退化比双重编码更难查，而在此之前它<b>只有注释在保护</b>。
     * 这一组把它变成自动化断言：任何让 buildUri 产出相对地址的改动都会立刻红。
     */
    @Nested
    @DisplayName("寻址护栏：必须拼出带 baseUrl 的绝对地址")
    class AbsoluteAddressing {

        private static final String BASE = "http://mis-kb.internal:8108";

        @Test
        @DisplayName("经带 baseUrl 的 UriBuilder 工厂展开后是绝对 URI，且编码仍只有一次")
        void producesAbsoluteUri() {
            URI uri = invokeBuildUri("/internal/v1/kb/synonyms", Map.of("keyword", "季度"))
                    .apply(new DefaultUriBuilderFactory(BASE).builder());

            assertTrue(uri.isAbsolute(),
                    () -> "必须是绝对 URI，否则请求会打到默认主机上：" + uri);
            assertEquals("http", uri.getScheme());
            assertEquals("mis-kb.internal", uri.getHost());
            assertEquals(8108, uri.getPort());
            assertEquals("/internal/v1/kb/synonyms", uri.getRawPath());
            // 寻址正确的同时，DEF-01 的编码结论在这一层同样成立
            assertEquals("keyword=%E5%AD%A3%E5%BA%A6", uri.getRawQuery());
            assertTrue(uri.toString().startsWith(BASE), () -> "实际：" + uri);
        }

        @Test
        @DisplayName("服务发现模式：host 保留服务名 mis-kb，供 LoadBalancer 过滤器解析")
        void keepsServiceIdHostForLoadBalancer() {
            // kb-discovery-enabled=true 时 resolveBaseUrl() 产出 http://mis-kb，
            // LB filter 靠这个 host 查 Nacos 实例。丢了 host 就等于服务发现整条链路失效。
            URI uri = invokeBuildUri("/internal/v1/kb/synonyms", Map.of("keyword", "季度"))
                    .apply(new DefaultUriBuilderFactory("http://mis-kb").builder());

            assertTrue(uri.isAbsolute());
            assertEquals("mis-kb", uri.getHost(),
                    "host 必须是服务名，LoadBalancer 才能把它替换成真实实例地址");
        }

        @Test
        @DisplayName("baseUrl 自带 base path 时是追加而非覆盖（与改动前 uri(String) 行为一致）")
        void appendsToBasePathInsteadOfReplacing() {
            URI uri = invokeBuildUri("/internal/v1/kb/synonyms", Map.of())
                    .apply(new DefaultUriBuilderFactory(BASE + "/kb").builder());

            assertEquals("/kb/internal/v1/kb/synonyms", uri.getRawPath(),
                    "必须是 path() 追加语义；换成 replacePath() 会把网关前缀吃掉");
        }
    }

    @Nested
    @DisplayName("根因固化：证明「已编码字符串 + uri(String)」必然二次编码")
    class RootCauseFossil {

        /**
         * 复现旧写法，钉死「为什么不能把 buildUri 改回返回 String」。
         *
         * <p>{@code WebClient.uri(String)} 内部就是这个 {@link DefaultUriBuilderFactory}
         * （默认 {@code EncodingMode.TEMPLATE_AND_VALUES}）。把一段已编码的字符串喂进去，
         * 它会把 {@code %} 当成需要转义的字面量再编码一次。
         */
        @Test
        @DisplayName("已编码串再过一次 DefaultUriBuilderFactory：%E5 变成 %25E5")
        void preEncodedStringGetsEncodedTwice() {
            String preEncoded = UriComponentsBuilder.fromPath("/internal/v1/kb/operations/qa/export")
                    .queryParam("keyword", "季度")
                    .build()
                    .encode()
                    .toUriString();
            assertTrue(preEncoded.contains("keyword=%E5%AD%A3%E5%BA%A6"),
                    "旧 buildUri 的产物本身是对的，问题出在它之后又被编码了一次");

            URI doubled = new DefaultUriBuilderFactory("http://127.0.0.1:8108").expand(preEncoded);

            assertTrue(doubled.toString().contains("keyword=%25E5%25AD%25A3%25E5%25BA%25A6"),
                    () -> "这就是 DEF-01 的根因，下游解码后得到乱码 → 命中 0 行。实际：" + doubled);
        }

        /**
         * 同一条链路上，纯 ASCII 无空格关键词毫发无损 —— 解释「为什么 Alpha 一直是好的」。
         */
        @Test
        @DisplayName("纯 ASCII 关键词经二次编码后不变 —— 故障现象只在中文/空格上暴露")
        void asciiKeywordIsImmuneToDoubleEncoding() {
            String preEncoded = UriComponentsBuilder.fromPath("/internal/v1/kb/operations/qa/export")
                    .queryParam("keyword", "Alpha")
                    .build()
                    .encode()
                    .toUriString();

            URI doubled = new DefaultUriBuilderFactory("http://127.0.0.1:8108").expand(preEncoded);

            assertTrue(doubled.toString().endsWith("keyword=Alpha"),
                    "没有任何字符需要编码时，二次编码是恒等变换，这正是缺陷长期潜伏的原因");
        }

        /**
         * 固化「改成返回 {@link URI} + {@code uri(URI)}」为什么不行。
         *
         * <p>这是修 DEF-01 时最直觉、也最危险的写法：它确实绕开了二次编码，
         * 但产出的是<b>相对</b> URI。{@code uri(URI)} 不经过 {@code uriBuilderFactory}，
         * baseUrl 就此丢失。下面证明这种 URI 连 host 都没有。
         */
        @Test
        @DisplayName("相对 URI 没有 scheme/host —— 这就是 uri(URI) 会静默丢 baseUrl 的原因")
        void relativeUriCarriesNoHost() {
            String preEncoded = UriComponentsBuilder.fromPath("/internal/v1/kb/synonyms")
                    .queryParam("keyword", "季度")
                    .build()
                    .encode()
                    .toUriString();

            URI relative = URI.create(preEncoded);

            assertFalse(relative.isAbsolute(),
                    "相对 URI 交给 uri(URI) 后，请求将没有目标主机");
            assertNull(relative.getHost());
            assertNull(relative.getScheme());
        }
    }
}
