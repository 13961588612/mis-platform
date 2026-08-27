package com.mis.recon.service.pull;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.util.JsonUtil;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * ApiFetcher 单测（第四批 P 组 api 单测，取数层需求规格 §7）。
 * <p>JDK 内置 HttpServer mock 源端；覆盖：url 窗口占位注入 / cursor 游标翻页 / page_no 翻页 /
 * data_path 取数 / headers 鉴权（${ENV}）/ 重试退避 / 限速 / 响应容错。</p>
 */
class ApiFetcherTest {

    private HttpServer server;
    private int port;
    private final List<String> queries = Collections.synchronizedList(new ArrayList<>());
    private final List<String> authHeaders = Collections.synchronizedList(new ArrayList<>());
    private volatile int requestCount = 0;
    private volatile int status = 200;
    private volatile int failFirstN = 0;

    @BeforeEach
    void setUp() throws IOException {
        server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/bills", this::handle);
        server.start();
        port = server.getAddress().getPort();
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    private void handle(HttpExchange ex) throws IOException {
        requestCount++;
        queries.add(ex.getRequestURI().getQuery() == null ? "" : ex.getRequestURI().getQuery());
        List<String> auth = ex.getRequestHeaders().getOrDefault("Authorization", List.of());
        if (!auth.isEmpty()) {
            authHeaders.add(auth.get(0));
        }
        int code = failFirstN >= requestCount ? 500 : status;
        String body = responseBody();
        ex.sendResponseHeaders(code, body.getBytes(StandardCharsets.UTF_8).length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(body.getBytes(StandardCharsets.UTF_8));
        }
    }

    /** 默认响应：空数组。子类/测试可重设。 */
    private volatile String responseBody = "[]";

    private String responseBody() {
        return responseBody;
    }

    private ObjectNode cfg(String extra) {
        return JsonUtil.parseObject("{\"url\":\"http://localhost:" + port + "/bills?start={time_start}&end={time_end}\","
                + "\"method\":\"GET\","
                + "\"page\":{\"mode\":\"cursor\",\"cursor_param\":\"cursor\",\"cursor_path\":\"$.data.next_cursor\",\"size_param\":\"limit\",\"size\":500},"
                + "\"data_path\":\"$.data.list\""
                + (extra == null || extra.isBlank() ? "" : "," + extra) + "}");
    }

    private ApiFetcher fetcher(ObjectNode cfg) {
        return new ApiFetcher(cfg, Map.of("TOKEN", "secret-123"));
    }

    private LocalDateTime start() {
        return LocalDateTime.of(2026, 8, 26, 10, 0, 0);
    }

    // ==================== 8 条 ====================

    @Test
    void urlWindowPlaceholdersInjected() {
        // P-1：{time_start}/{time_end} 注入 query，格式 yyyy-MM-dd HH:mm:ss
        responseBody = "{\"data\":{\"list\":[]}}";
        ApiFetcher f = fetcher(cfg(null));
        List<Map<String, Object>> rows = f.probe(start(), start().plusHours(1));
        assertTrue(rows.isEmpty());
        assertEquals(1, queries.size());
        String q = queries.get(0);
        // URI.getQuery() 返回解码后的 query：%3A → :，空格 → +
        assertTrue(q.contains("start=2026-08-26"), "窗口起点注入: " + q);
        assertTrue(q.contains("10:00:00"), "窗口起点时间格式: " + q);
        assertTrue(q.contains("end=2026-08-26"), "窗口终点注入: " + q);
    }

    @Test
    void cursorPagination() {
        // P-2：cursor 游标翻页 → 游标空结束
        List<String> pages = new ArrayList<>(List.of(
                "{\"data\":{\"list\":[{\"order_no\":\"A1\"}],\"next_cursor\":\"abc\"}}",
                "{\"data\":{\"list\":[{\"order_no\":\"A2\"}],\"next_cursor\":\"\"}}"));
        responseBody = pages.remove(0);
        ApiFetcher f = fetcher(cfg(null));
        FetchBatch b1 = f.fetchBatch(start(), start().plusHours(1), null, null, null, null, 100);
        assertEquals(1, b1.rows().size());
        responseBody = pages.remove(0);
        FetchBatch b2 = f.fetchBatch(start(), start().plusHours(1), null, null, null, null, 100);
        assertEquals(1, b2.rows().size());
        FetchBatch b3 = f.fetchBatch(start(), start().plusHours(1), null, null, null, null, 100);
        assertTrue(b3.rows().isEmpty(), "游标为空 → 拉取结束");
        // 第二次请求带 cursor=abc
        assertEquals(2, queries.size());
        assertTrue(queries.get(1).contains("cursor=abc"), "游标透传: " + queries.get(1));
    }

    @Test
    void pageNoPagination() {
        // P-3：page_no 翻页，size=2 → 2+1+空；page 参数递增
        responseBody = "{\"data\":{\"list\":[{\"o\":1},{\"o\":2}]}}";
        ObjectNode cfg = JsonUtil.parseObject("{\"url\":\"http://localhost:" + port + "/bills?start={time_start}&end={time_end}\","
                + "\"method\":\"GET\","
                + "\"page\":{\"mode\":\"page_no\",\"size_param\":\"limit\",\"size\":2},"
                + "\"data_path\":\"$.data.list\"}");
        ApiFetcher f = new ApiFetcher(cfg, Map.of());
        FetchBatch b1 = f.fetchBatch(start(), start().plusHours(1), null, null, null, null, 100);
        assertEquals(2, b1.rows().size());
        responseBody = "{\"data\":{\"list\":[{\"o\":3}]}}";
        FetchBatch b2 = f.fetchBatch(start(), start().plusHours(1), null, null, null, null, 100);
        assertEquals(1, b2.rows().size());
        FetchBatch b3 = f.fetchBatch(start(), start().plusHours(1), null, null, null, null, 100);
        assertTrue(b3.rows().isEmpty());
        assertEquals(2, queries.size());
        assertTrue(queries.get(0).contains("page=1"), "页码 1: " + queries.get(0));
        assertTrue(queries.get(1).contains("page=2"), "页码 2: " + queries.get(1));
    }

    @Test
    void dataPathExtractsRows() {
        // P-4：data_path 定位数组 → 行集
        responseBody = "{\"data\":{\"list\":[{\"a\":1},{\"a\":2}]}}";
        ApiFetcher f = fetcher(cfg(null));
        List<Map<String, Object>> rows = f.probe(start(), start().plusHours(1));
        assertEquals(2, rows.size());
        assertEquals(1, rows.get(0).get("a"));
    }

    @Test
    void headersWithEnvInjected() {
        // P-5：headers 鉴权注入，${ENV} 解析（不落库明文）
        responseBody = "{\"data\":{\"list\":[]}}";
        ObjectNode cfg = JsonUtil.parseObject("{\"url\":\"http://localhost:" + port + "/bills?start={time_start}&end={time_end}\","
                + "\"method\":\"GET\","
                + "\"headers\":{\"Authorization\":\"Bearer ${TOKEN}\"},"
                + "\"page\":{\"mode\":\"page_no\",\"size\":500},"
                + "\"data_path\":\"$.data.list\"}");
        ApiFetcher f = new ApiFetcher(cfg, Map.of("TOKEN", "secret-123"));
        f.probe(start(), start().plusHours(1));
        assertEquals(1, authHeaders.size());
        assertEquals("Bearer secret-123", authHeaders.get(0));
    }

    @Test
    void retryOn5xxWithBackoff() {
        // P-6：500 → 重试 1 次 → 200；请求 2 次
        responseBody = "{\"data\":{\"list\":[{\"o\":1}]}}";
        ObjectNode cfg = JsonUtil.parseObject("{\"url\":\"http://localhost:" + port + "/bills?start={time_start}&end={time_end}\","
                + "\"method\":\"GET\","
                + "\"page\":{\"mode\":\"page_no\",\"size\":500},"
                + "\"data_path\":\"$.data.list\","
                + "\"retry\":{\"max\":1,\"backoff_ms\":1}}");
        failFirstN = 1;
        status = 200;
        ApiFetcher f = new ApiFetcher(cfg, Map.of());
        List<Map<String, Object>> rows = f.probe(start(), start().plusHours(1));
        assertEquals(1, rows.size());
        assertEquals(2, requestCount, "500 后应重试一次");
    }

    @Test
    void rateLimitQpsThrottles() {
        // P-7：qps=2 → 两次请求间隔 ≥ 450ms（令牌间隔 500ms，宽松断言）
        responseBody = "{\"data\":{\"list\":[{\"o\":1},{\"o\":2}]}}";
        ObjectNode cfg = JsonUtil.parseObject("{\"url\":\"http://localhost:" + port + "/bills?start={time_start}&end={time_end}\","
                + "\"method\":\"GET\","
                + "\"page\":{\"mode\":\"page_no\",\"size\":1},"
                + "\"data_path\":\"$.data.list\","
                + "\"rate_limit_qps\":2}");
        ApiFetcher f = new ApiFetcher(cfg, Map.of());
        long t0 = System.currentTimeMillis();
        f.fetchBatch(start(), start().plusHours(1), null, null, null, null, 100);
        responseBody = "{\"data\":{\"list\":[]}}";
        f.fetchBatch(start(), start().plusHours(1), null, null, null, null, 100);
        long elapsed = System.currentTimeMillis() - t0;
        assertTrue(elapsed >= 450, "限速间隔不足: " + elapsed + "ms");
    }

    @Test
    void dataPathMissingThrows() {
        // P-8：data_path 定位不到数组 → 拉取 error（不静默吞掉）
        responseBody = "{\"data\":{\"list\":[{\"o\":1}]}}";
        ObjectNode cfg = JsonUtil.parseObject("{\"url\":\"http://localhost:" + port + "/bills?start={time_start}&end={time_end}\","
                + "\"method\":\"GET\","
                + "\"page\":{\"mode\":\"page_no\",\"size\":500},"
                + "\"data_path\":\"$.data.nope\"}");
        ApiFetcher f = new ApiFetcher(cfg, Map.of());
        BizException ex = assertThrows(BizException.class, () -> f.probe(start(), start().plusHours(1)));
        assertEquals(ErrorCode.FETCH_API_ERROR.getCode(), ex.getCode());
    }
}
