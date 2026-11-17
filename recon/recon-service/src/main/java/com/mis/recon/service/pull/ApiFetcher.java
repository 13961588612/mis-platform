package com.mis.recon.service.pull;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.mis.recon.common.BizException;
import com.mis.recon.common.ErrorCode;
import com.mis.recon.util.JsonUtil;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * api 取数执行器（第四批 P1~P3/P5，取数层需求规格 §3，内置 HTTP 通道）。
 * <p>能力：</p>
 * <ul>
 *   <li>{@code {time_start}} / {@code {time_end}} 窗口占位注入 URL（yyyy-MM-dd HH:mm:ss，§3.2）；</li>
 *   <li>分页游标：cursor（cursor_param + cursor_path）与 page_no 双模式（§3.3），data_path JSONPath 定位数组；</li>
 *   <li>鉴权：静态 headers 注入 + {@code ${ENV}} 环境变量占位（§3.4，凭据不落库明文）；</li>
 *   <li>重试：retry.max + retry.backoff_ms 指数退避；限速：rate_limit_qps 令牌间隔（§3.5）；</li>
 *   <li>fetch_one：fetch_one_url + fetch_one_params（{@code {record_key}} 占位，§3.7）。</li>
 * </ul>
 * <p>无状态（分页游标在实例内推进，loadCtx 每次 new）。HTTP 用 JDK 内置 HttpClient，零第三方依赖。</p>
 */
public class ApiFetcher implements PullFetcher {

    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final Pattern ENV_PATTERN = Pattern.compile("\\$\\{([A-Za-z0-9_]+)}");
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(30))
            .build();
    private static final ObjectMapper OM = new ObjectMapper();

    /** 测试注入用环境变量表（null → System.getenv） */
    private final Map<String, String> env;

    // 配置（fetch_config_json 解析，取数层需求规格 §3.1）
    private final String url;
    private final String method;
    private final Map<String, String> headers;
    private final String pageMode;      // cursor / page_no
    private final String cursorParam;
    private final String cursorPath;
    private final String sizeParam;
    private final int size;             // 每页大小
    private final String dataPath;      // 响应数组定位，可空（整体为数组）
    private final int maxRetries;
    private final long backoffMs;
    private final double qps;
    private final String fetchOneUrl;
    private final Map<String, String> fetchOneParams;

    // 分页状态（每次 run 新实例）
    private String cursor;      // cursor 模式当前游标（null=首轮不带）
    private int pageNo = 0;     // page_no 模式页码（1 起）
    private boolean ended;      // 拉取结束
    private long lastRequestMs = 0;

    /** 生产构造：环境变量走 System.getenv。 */
    public ApiFetcher(com.fasterxml.jackson.databind.node.ObjectNode cfg) {
        this(cfg, null);
    }

    /** 包私有构造：允许测试注入环境变量表。 */
    ApiFetcher(com.fasterxml.jackson.databind.node.ObjectNode cfg, Map<String, String> env) {
        this.env = env;
        this.url = cfg == null ? null : cfg.path("url").asText(null);
        this.method = (cfg == null ? "GET" : cfg.path("method").asText("GET")).toUpperCase();
        this.headers = toMap(cfg == null ? null : cfg.path("headers"));
        JsonNode page = cfg == null ? null : cfg.path("page");
        this.pageMode = page == null ? "cursor" : page.path("mode").asText("cursor");
        this.cursorParam = page == null ? "cursor" : page.path("cursor_param").asText("cursor");
        this.cursorPath = page == null ? null : page.path("cursor_path").asText(null);
        this.sizeParam = page == null ? "limit" : page.path("size_param").asText("limit");
        int sz = page == null ? 500 : page.path("size").asInt(500);
        this.size = sz < 1 ? 500 : sz;
        this.dataPath = cfg == null ? null : cfg.path("data_path").asText(null);
        JsonNode retry = cfg == null ? null : cfg.path("retry");
        this.maxRetries = retry == null ? 0 : retry.path("max").asInt(0);
        this.backoffMs = retry == null ? 2000 : retry.path("backoff_ms").asLong(2000);
        double q = cfg == null ? 0 : cfg.path("rate_limit_qps").asDouble(0);
        this.qps = q < 0 ? 0 : q;
        this.fetchOneUrl = cfg == null ? null : cfg.path("fetch_one_url").asText(null);
        this.fetchOneParams = toMap(cfg == null ? null : cfg.path("fetch_one_params"));
    }

    @Override
    public FetchBatch fetchBatch(LocalDateTime start, LocalDateTime end,
                                 LocalDateTime lastTime, String lastPk,
                                 String timeField, String pkField, int batchSize) {
        if (ended) {
            return new FetchBatch(List.of(), lastTime, lastPk);
        }
        PageResult page = fetchPage(start, end);
        if (page.rows.isEmpty()) {
            ended = true;
            return new FetchBatch(List.of(), lastTime, lastPk);
        }
        if ("page_no".equals(pageMode)) {
            pageNo++;
            if (page.rows.size() < size) {
                ended = true;   // 最后页（行数不足一页）
            }
        } else {
            // cursor：下一页游标为空/缺失 → 结束
            cursor = page.nextCursor;
            if (cursor == null) {
                ended = true;
            }
        }
        return new FetchBatch(page.rows, lastTime, lastPk);
    }

    @Override
    public List<Map<String, Object>> probe(LocalDateTime start, LocalDateTime end) {
        return fetchPage(start, end).rows;
    }

    @Override
    public Map<String, Object> fetchOne(String recordKey) {
        if (fetchOneUrl == null || fetchOneUrl.isBlank()) {
            throw new BizException(ErrorCode.FETCH_ONE_SQL_MISSING,
                    "fetch_one_url 未配置，api 数据源无法单条重拉");
        }
        String u = fetchOneUrl.replace("{record_key}",
                URLEncoder.encode(recordKey == null ? "" : recordKey, StandardCharsets.UTF_8));
        for (Map.Entry<String, String> e : fetchOneParams.entrySet()) {
            u = appendQuery(u, e.getKey(), e.getValue());
        }
        HttpResponse<String> resp = execute(u);
        JsonNode root = JsonUtil.parse(resp.body());
        JsonNode arr = locateArray(root);
        if (arr == null || arr.isEmpty()) {
            return null;
        }
        return OM.convertValue(arr.get(0), new TypeReference<Map<String, Object>>() {
        });
    }

    // ==================== 内部 ====================

    /** 拉一页（首轮无游标；不推进分页状态，由 fetchBatch 推进）。 */
    private PageResult fetchPage(LocalDateTime start, LocalDateTime end) {
        String u = buildPageUrl(buildWindowUrl(start, end));
        HttpResponse<String> resp = execute(u);
        JsonNode root = JsonUtil.parse(resp.body());
        List<Map<String, Object>> rows = extractRows(root);
        String next = null;
        if ("cursor".equals(pageMode) && cursorPath != null) {
            JsonNode n = navigate(root, cursorPath);
            if (n != null && n.isTextual() && !n.asText().isBlank()) {
                next = n.asText();
            }
        }
        return new PageResult(rows, next);
    }

    /** 窗口占位注入：{time_start}/{time_end} → yyyy-MM-dd HH:mm:ss（URL 编码，§3.2）。 */
    private String buildWindowUrl(LocalDateTime start, LocalDateTime end) {
        String u = url == null ? "" : url;
        return u.replace("{time_start}", encodeTime(start))
                .replace("{time_end}", encodeTime(end));
    }

    private static String encodeTime(LocalDateTime t) {
        return URLEncoder.encode(TIME_FMT.format(t), StandardCharsets.UTF_8);
    }

    /** 分页参数拼接：cursor → cursor_param；page_no → page（pageNo 表示已拉页数，当前页 +1）；每页 size_param + size。 */
    private String buildPageUrl(String u) {
        if ("page_no".equals(pageMode)) {
            u = appendQuery(u, "page", pageNo + 1);
        } else if (cursor != null) {
            u = appendQuery(u, cursorParam, cursor);
        }
        return appendQuery(u, sizeParam, size);
    }

    private String appendQuery(String url, String key, Object value) {
        if (value == null || String.valueOf(value).isBlank()) {
            return url;
        }
        String sep = url.contains("?") ? "&" : "?";
        return url + sep + key + "=" + URLEncoder.encode(String.valueOf(value), StandardCharsets.UTF_8);
    }

    /** 发请求：限速 → 重试（指数退避，仅网络异常与 429/5xx）→ 2xx 返回。 */
    private HttpResponse<String> execute(String u) {
        HttpRequest.Builder rb = HttpRequest.newBuilder(URI.create(u))
                .timeout(Duration.ofSeconds(120));
        for (Map.Entry<String, String> h : headers.entrySet()) {
            String v = expandEnv(h.getValue());
            if (v != null && !v.isBlank()) {
                rb.header(h.getKey(), v);
            }
        }
        rb.method(method, HttpRequest.BodyPublishers.noBody());
        HttpRequest req = rb.build();

        int attempt = 0;
        while (true) {
            throttle();
            try {
                HttpResponse<String> resp = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
                int code = resp.statusCode();
                if (code >= 200 && code < 300) {
                    return resp;
                }
                if ((code == 429 || code >= 500) && attempt < maxRetries) {
                    attempt++;
                    backoff(attempt);
                    continue;
                }
                throw new BizException(ErrorCode.FETCH_API_ERROR,
                        "api 拉取失败 HTTP " + code + ": " + truncate(resp.body()));
            } catch (IOException e) {
                if (attempt < maxRetries) {
                    attempt++;
                    backoff(attempt);
                    continue;
                }
                throw new BizException(ErrorCode.FETCH_API_ERROR, "api 拉取网络异常: " + e.getMessage());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new BizException(ErrorCode.FETCH_API_ERROR, "api 拉取请求中断");
            }
        }
    }

    private void backoff(int attempt) {
        long ms = backoffMs * (1L << (attempt - 1));
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw new BizException(ErrorCode.FETCH_API_ERROR, "api 拉取重试中断");
        }
    }

    /** rate_limit_qps 令牌间隔（§3.5，默认不限速）。 */
    private void throttle() {
        if (qps <= 0) {
            return;
        }
        long interval = (long) (1000.0 / qps);
        long now = System.currentTimeMillis();
        long wait = interval - (now - lastRequestMs);
        if (wait > 0) {
            try {
                Thread.sleep(wait);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new BizException(ErrorCode.FETCH_API_ERROR, "api 拉取限速中断");
            }
        }
        lastRequestMs = System.currentTimeMillis();
    }

    /** ${ENV} 环境变量占位解析（§3.4，不落库明文）。 */
    private String expandEnv(String v) {
        if (v == null || !v.contains("${")) {
            return v;
        }
        Matcher m = ENV_PATTERN.matcher(v);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            String name = m.group(1);
            String val = env != null ? env.get(name) : System.getenv(name);
            m.appendReplacement(sb, Matcher.quoteReplacement(val == null ? "" : val));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    /** data_path 定位数组；未配置 → 整体按数组处理（§3.3）。 */
    private JsonNode locateArray(JsonNode root) {
        if (dataPath == null || dataPath.isBlank()) {
            return root.isArray() ? root : null;
        }
        JsonNode n = navigate(root, dataPath);
        return n != null && n.isArray() ? n : null;
    }

    private List<Map<String, Object>> extractRows(JsonNode root) {
        JsonNode arr = locateArray(root);
        if (arr == null) {
            throw new BizException(ErrorCode.FETCH_API_ERROR,
                    "data_path 定位不到数组: " + (dataPath == null ? "<整体>" : dataPath));
        }
        List<Map<String, Object>> rows = new ArrayList<>();
        for (JsonNode n : arr) {
            if (!n.isObject()) {
                continue;
            }
            rows.add(OM.convertValue(n, new TypeReference<Map<String, Object>>() {
            }));
        }
        return rows;
    }

    /** 轻量 JSONPath 导航（$.data.list / data.list / 支持 [n] 下标），定位不到返回 null。 */
    static JsonNode navigate(JsonNode root, String path) {
        if (path == null || path.isBlank()) {
            return root;
        }
        String p = path.trim();
        if (p.startsWith("$")) {
            p = p.substring(1);
        }
        if (p.startsWith(".")) {
            p = p.substring(1);
        }
        if (p.isBlank()) {
            return root;
        }
        JsonNode cur = root;
        for (String seg : p.split("\\.")) {
            if (seg.isEmpty()) {
                continue;
            }
            int idx = indexOf(seg);
            String name = idx >= 0 ? seg.substring(0, idx) : seg;
            if (!name.isEmpty()) {
                if (cur == null) {
                    return null;
                }
                cur = cur.path(name);
            }
            if (idx >= 0) {
                if (cur == null || !cur.isArray()) {
                    return null;
                }
                cur = idx < cur.size() ? cur.get(idx) : null;
            }
            if (cur == null || cur.isMissingNode()) {
                return null;
            }
        }
        return cur;
    }

    /** 段尾 [n] 下标；无则 -1。 */
    private static int indexOf(String seg) {
        int b = seg.indexOf('[');
        if (b < 0 || !seg.endsWith("]")) {
            return -1;
        }
        String inner = seg.substring(b + 1, seg.length() - 1);
        try {
            return Integer.parseInt(inner.trim());
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private static String truncate(String s) {
        if (s == null) {
            return "";
        }
        return s.length() <= 500 ? s : s.substring(0, 500);
    }

    private static Map<String, String> toMap(JsonNode node) {
        Map<String, String> map = new HashMap<>();
        if (node == null || !node.isObject()) {
            return map;
        }
        node.fields().forEachRemaining(e -> map.put(e.getKey(),
                e.getValue().isValueNode() ? e.getValue().asText() : e.getValue().toString()));
        return map;
    }

    /** 一页结果：行集 + 下一页游标（cursor 模式）。 */
    private record PageResult(List<Map<String, Object>> rows, String nextCursor) {
    }
}
