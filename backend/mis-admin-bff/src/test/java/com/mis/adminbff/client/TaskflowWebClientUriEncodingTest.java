package com.mis.adminbff.client;

import com.mis.adminbff.config.BffProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.DefaultUriBuilderFactory;
import org.springframework.web.util.UriComponentsBuilder;
import reactor.core.publisher.Mono;

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
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@code TaskflowWebClient} 出站查询串编码回归测试 —— 守护
 * 「经网关（8080）调用 BFF 的中文检索/筛选恒返 0 条」的修复。
 *
 * <h2>缺陷回放</h2>
 * 旧实现每个方法都是：
 * <pre>
 *   String uri = UriComponentsBuilder.fromPath("/internal/v1/messages/search")
 *           ...queryParam("q", keyword)
 *           .toUriString();                       // ← 已做一次百分号编码
 *   client().get().uri(uri)...                     // ← 默认 TEMPLATE_AND_VALUES 又编码一次
 * </pre>
 * 于是中文 {@code 通过} → {@code q=%E9%80%9A%E8%BF%87} → {@code q=%25E9%2580%259A%25E8%25BF%2587}。
 * 下游 mis-taskflow 只解一次码，拿到字面量 {@code %E9...}，永远匹配不上 → 0 条；ASCII 关键词
 * 无字符需编码，二次编码是恒等变换，因此单测（关键词都是 {@code marker}/{@code a}）从未暴露。
 *
 * <h2>为什么用「捕获出站 URL」的方式</h2>
 * 证据全部在<b>真实发出的那一行 URL</b>里。这里用一个自定义 {@code ExchangeFunction} —— 它拿到的
 * {@code ClientRequest.url()} 是 WebClient 完成 baseUrl 拼接与编码<b>之后</b>的最终 URI，
 * 拿到的就是下游会看到的字节。断言不看返回值、只看它，才能钉住编码与寻址两件事。
 *
 * <p>特别地，本测试<b>同时</b>断言 {@code Host}（即 baseUrl 的 scheme/host/port）没有丢：
 * 修 DEF 时最危险的写法是把 {@code java.net.URI} 交给 {@code uri(URI)} —— 它虽不二次编码，
 * 但不经过 {@code uriBuilderFactory}，相对 URI 会把 baseUrl 整个丢掉（{@link RootCauseFossil}
 * 用真实 WebClient 复现了这一点）。
 */
class TaskflowWebClientUriEncodingTest {

    /** 下游 baseUrl 的 host，用于核对请求确实打到 taskflow 而非被丢成相对地址。 */
    private static final String BASE = "http://taskflow.upstream.test:8104";

    /** 一条可完整反序列化为 {@code Result<PageResult<MessageVO>>} 的最小响应。 */
    private static final String MESSAGE_PAGE_BODY = "{\"code\":0,\"message\":\"ok\",\"data\":"
            + "{\"page\":1,\"size\":20,\"total\":1,\"list\":[{"
            + "\"id\":\"m1\",\"tenantId\":\"1\",\"msgType\":\"NOTIFY\",\"category\":\"C\",\"title\":\"通过\","
            + "\"summary\":\"s\",\"senderId\":\"1\",\"senderName\":\"sys\",\"referenceTaskId\":null,"
            + "\"receiverGroupType\":\"ALL\",\"read\":false,\"readCount\":0,\"totalCount\":1,"
            + "\"createdAt\":null,\"instanceId\":null,\"canReply\":true}]}}";

    /** 可完整反序列化为 {@code Result<MessageDetailVO>} 的最小响应。 */
    private static final String MESSAGE_DETAIL_BODY =
            "{\"code\":0,\"message\":\"ok\",\"data\":null}";

    /** 可完整反序列化为 {@code Result<List<AuditTimelineItem>>} 的最小响应。 */
    private static final String TIMELINE_BODY = "{\"code\":0,\"message\":\"ok\",\"data\":[]}";

    private final AtomicReference<URI> capturedUrl = new AtomicReference<>();
    private volatile String responseBody = MESSAGE_PAGE_BODY;

    private TaskflowWebClient client;

    @BeforeEach
    void setUp() {
        capturedUrl.set(null);
        responseBody = MESSAGE_PAGE_BODY;

        // 与生产装配同构：走 TaskflowWebClient 自己的 buildClient()，baseUrl 由 BffProperties 决定；
        // 仅把底层连接换成「记录出站 URL + 返回预置 JSON」的 ExchangeFunction。
        WebClient.Builder recording = WebClient.builder().exchangeFunction(req -> {
            capturedUrl.set(req.url());
            return Mono.just(ClientResponse.create(HttpStatus.OK)
                    .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                    .body(responseBody)
                    .build());
        });

        BffProperties properties = new BffProperties();
        properties.setTaskflowDiscoveryEnabled(false);
        properties.setTaskflowBaseUrl(BASE);
        properties.setAggregateTimeoutMs(5000);

        client = new TaskflowWebClient(recording, WebClient.builder(), properties);
    }

    // ------------------------------------------------------------------ 辅助

    /** 取原始（未解码）查询参数的字节，这就是下游 mis-taskflow 收到的原始值。 */
    private static String rawParam(URI uri, String name) {
        String query = uri.getRawQuery();
        if (query == null || query.isEmpty()) {
            return null;
        }
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            String key = eq < 0 ? pair : pair.substring(0, eq);
            if (key.equals(name)) {
                return eq < 0 ? "" : pair.substring(eq + 1);
            }
        }
        return null;
    }

    /** 取某个查询参数解码后的值 —— 就是下游实际拿到的关键词/筛选值。 */
    private static String decodedParam(URI uri, String name) {
        String raw = rawParam(uri, name);
        return raw == null ? null : URLDecoder.decode(raw, StandardCharsets.UTF_8);
    }

    private URI requireCaptured() {
        URI uri = capturedUrl.get();
        assertNotNull(uri, "下游必须真的收到了请求");
        return uri;
    }

    /** 核心断言：查询串里不得出现 {@code %25}（= 「%」又被编码了一次的指纹）。 */
    private URI assertNoDoubleEncodingAndHitsTaskflow() {
        URI uri = requireCaptured();
        assertEquals("http", uri.getScheme(), "必须保留 baseUrl 的 scheme");
        assertEquals("taskflow.upstream.test", uri.getHost(),
                "必须保留 baseUrl 的 host —— 若有人改用 uri(URI) 传相对地址，baseUrl 会被整个丢掉");
        assertEquals(8104, uri.getPort(), "必须保留 baseUrl 的 port");
        String query = uri.getRawQuery();
        if (query != null) {
            assertFalse(query.contains("%25"),
                    () -> "查询串出现 %25，说明已编码串又被 WebClient 编码了一次（双重编码回归）：" + query);
        }
        return uri;
    }

    @Nested
    @DisplayName("主场景：非 ASCII 关键词只编码一次，且 baseUrl 保留")
    class SingleEncoding {

        @Test
        @DisplayName("searchMessages 中文「通过」→ q=%E9%80%9A%E8%BF%87，且不含 %25")
        void chineseKeywordEncodedExactlyOnce() {
            client.searchMessages(1L, 1L, "NOTIFY", "通过", 1, 20);

            URI uri = assertNoDoubleEncodingAndHitsTaskflow();
            assertEquals("/internal/v1/messages/search", uri.getRawPath(), "路径必须原样送达");
            assertEquals("%E9%80%9A%E8%BF%87", rawParam(uri, "q"),
                    "修复前这里是 %25E9%2580%259A%25E8%25BF%2587，下游解一次码拿到字面量 → 0 条");
            assertEquals("通过", decodedParam(uri, "q"), "下游解码后必须还原成用户输入原文，否则检索必然 0 行");
            // 其余参数原样、顺序不变
            assertEquals("1", rawParam(uri, "tenantId"));
            assertEquals("1", rawParam(uri, "userId"));
            assertEquals("NOTIFY", rawParam(uri, "msgType"));
            assertEquals("1", rawParam(uri, "page"));
            assertEquals("20", rawParam(uri, "size"));
            assertEquals("tenantId=1&userId=1&msgType=NOTIFY&q=%E9%80%9A%E8%BF%87&page=1&size=20",
                    uri.getRawQuery(), "参数顺序与旧实现保持一致");
        }

        @Test
        @DisplayName("ASCII 关键词「marker」保持原样 —— 修复不能把本来正常的路径改坏")
        void plainAsciiKeywordUnchanged() {
            client.searchMessages(1L, 1L, null, "marker", 1, 20);

            URI uri = assertNoDoubleEncodingAndHitsTaskflow();
            assertEquals("marker", rawParam(uri, "q"),
                    "这条在修复前后都应通过；它在这里是为了证明修复没有引入新的转义");
            assertNull(rawParam(uri, "msgType"), "msgType 为 null 时不应出现在查询串里");
        }

        @Test
        @DisplayName("路径变量方法（messageDetail）同样保留 baseUrl，路径变量原样展开")
        void pathVariableMethodPreservesBaseUrl() {
            responseBody = MESSAGE_DETAIL_BODY;
            client.messageDetail(42L, 7L);

            URI uri = assertNoDoubleEncodingAndHitsTaskflow();
            assertEquals("/internal/v1/messages/42", uri.getRawPath());
            assertEquals("7", rawParam(uri, "userId"));
            assertEquals("userId=7", uri.getRawQuery());
        }

        @Test
        @DisplayName("中文路径变量（auditTimeline）也只编码一次")
        void chinesePathVariableSingleEncoded() {
            responseBody = TIMELINE_BODY;
            assertDoesNotThrow(() -> client.auditTimeline(1L, "流程", "通过"));

            URI uri = assertNoDoubleEncodingAndHitsTaskflow();
            assertEquals("/internal/v1/audit-ops/timeline/%E6%B5%81%E7%A8%8B/%E9%80%9A%E8%BF%87", uri.getRawPath(),
                    "路径变量必须只编码一次；双重编码会变成 %25E6%25B5%2581...");
            assertEquals("1", rawParam(uri, "tenantId"));
        }
    }

    @Nested
    @DisplayName("参数值是数据，不是结构")
    class ValuesAreData {

        @Test
        @DisplayName("值里的 & 与 = 被整体编码，不会劈成多个查询参数")
        void reservedCharactersDoNotSplitQuery() {
            client.searchMessages(1L, 1L, null, "A&B=C", 1, 20);

            URI uri = assertNoDoubleEncodingAndHitsTaskflow();
            assertEquals("A&B=C", decodedParam(uri, "q"));
            long ampCount = uri.getRawQuery().chars().filter(c -> c == '&').count();
            assertEquals(4, ampCount, () -> "只有 5 个参数 = 4 个 & 分隔符；值里的 & 未被编码就会多出来：" + uri.getRawQuery());
        }

        @Test
        @DisplayName("值里的花括号被当成普通字符，不会被误解析成 URI 模板变量")
        void bracesAreNotTreatedAsUriTemplate() {
            // 值以 {qN} 占位 + build(Map) 展开，用户输入里的花括号因此永远进不了模板层。
            assertDoesNotThrow(() -> client.searchMessages(1L, 1L, null, "季度{报表}", 1, 20));

            URI uri = assertNoDoubleEncodingAndHitsTaskflow();
            assertEquals("季度{报表}", decodedParam(uri, "q"));
        }

        @Test
        @DisplayName("值里已有的百分号被正确转义成 %25，且不会再叠一层")
        void literalPercentEscapedOnce() {
            client.searchMessages(1L, 1L, null, "100%", 1, 20);

            URI uri = requireCaptured();
            // 这是唯一允许出现 %25 的场景：用户真的输入了 %。
            assertEquals("100%25", rawParam(uri, "q"));
            assertEquals("100%", decodedParam(uri, "q"), "解码后必须还原成 100%，%2525 就是又叠了一层");
        }
    }

    @Nested
    @DisplayName("既有筛选语义保持不变")
    class FilteringSemanticsPreserved {

        @Test
        @DisplayName("inbox：msgType 为 null 时不出现，为空串时保留（沿用旧 Optional.ofNullable 语义）")
        void inboxNullVsBlankMsgType() {
            client.inbox(1L, 2L, null, 1, 20);
            assertNull(rawParam(requireCaptured(), "msgType"), "null 视为「没传」");

            capturedUrl.set(null);
            client.inbox(1L, 2L, "", 1, 20);
            assertEquals("", rawParam(requireCaptured(), "msgType"), "空串按旧语义保留为空值，而非被过滤");
        }

        @Test
        @DisplayName("myTasks：status 为 null 时不出现；keyword 空白时被过滤")
        void myTasksNullAndBlankFilters() {
            Map<String, Object> unused = new LinkedHashMap<>();
            unused.put("x", 1);
            client.myTasks(1L, 2L, null, "   ", 1, 20);

            URI uri = assertNoDoubleEncodingAndHitsTaskflow();
            assertNull(rawParam(uri, "status"));
            assertNull(rawParam(uri, "keyword"), "空白 keyword 应被过滤，否则下游按「等于三个空格」匹配");
        }
    }

    /**
     * 根因固化：把「不能改回去」的三条歧路各钉一颗钉子。
     *
     * <p>这些用例不依赖被测代码，描述的是 Spring URI 工具链本身的行为 —— 正因如此，它们才能在
     * 被测代码被改坏之后依然解释清楚「错在哪」。
     */
    @Nested
    @DisplayName("根因固化：双重编码、丢失 baseUrl、正确范式")
    class RootCauseFossil {

        private WebClient capturing(AtomicReference<URI> sink) {
            return WebClient.builder().baseUrl(BASE)
                    .exchangeFunction(req -> {
                        sink.set(req.url());
                        return Mono.just(ClientResponse.create(HttpStatus.OK)
                                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                                .body("{}").build());
                    }).build();
        }

        @Test
        @DisplayName("歧路一：toUriString() + uri(String) 必然二次编码，%E9 变成 %25E9")
        void preEncodedStringPlusUriStringDoubleEncodes() {
            String preEncoded = UriComponentsBuilder.fromPath("/internal/v1/messages/search")
                    .queryParam("q", "通过").build().encode().toUriString();
            assertTrue(preEncoded.contains("q=%E9%80%9A%E8%BF%87"), "预编码串本身是对的，问题在它之后又被编码一次");

            AtomicReference<URI> sink = new AtomicReference<>();
            capturing(sink).get().uri(preEncoded).retrieve().bodyToMono(String.class).block();

            assertTrue(sink.get().getRawQuery().contains("q=%25E9%2580%259A%25E8%25BF%2587"),
                    () -> "这就是本 Bug 的根因，下游解码后得到字面量 → 0 条。实际：" + sink.get());
        }

        @Test
        @DisplayName("歧路二：uri(URI) 传相对地址会丢掉 baseUrl（host 为空）")
        void uriWithRelativeUriDropsBaseUrl() {
            URI relative = UriComponentsBuilder.fromPath("/internal/v1/messages/search")
                    .queryParam("q", "通过").build().encode().toUri();
            assertFalse(relative.isAbsolute(), "UriComponentsBuilder 产出的就是相对 URI");

            AtomicReference<URI> sink = new AtomicReference<>();
            capturing(sink).get().uri(relative).retrieve().bodyToMono(String.class).block();

            assertNull(sink.get().getHost(),
                    () -> "uri(URI) 不经过 uriBuilderFactory，baseUrl 被整个丢掉（实测 host 为 null）：" + sink.get());
        }

        @Test
        @DisplayName("正确范式：uri(Function) 既保留 baseUrl 又只编码一次")
        void uriFunctionKeepsBaseUrlAndSingleEncodes() {
            AtomicReference<URI> sink = new AtomicReference<>();
            capturing(sink).get()
                    .uri(ub -> {
                        ub.path("/internal/v1/messages/search");
                        ub.queryParam("q", "{q0}");
                        return ub.build(Map.of("q0", "通过"));
                    })
                    .retrieve().bodyToMono(String.class).block();

            URI uri = sink.get();
            assertEquals("taskflow.upstream.test", uri.getHost());
            assertEquals("q=%E9%80%9A%E8%BF%87", uri.getRawQuery());
        }
    }
}
