package com.mis.adminbff.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.NullNode;
import com.mis.adminbff.support.AgentOpsErrorCodes;
import com.mis.adminbff.support.DownstreamAuthContext;
import com.mis.adminbff.support.DownstreamNotImplementedException;
import com.mis.common.core.constant.SecurityConstants;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.UriBuilder;
import reactor.core.publisher.Mono;

import java.net.URI;
import java.time.Duration;
import java.util.function.Function;

/**
 * agent-ops 下游传输层：<b>一次调用 → 一个 {@link JsonNode}</b>，并在这里完成
 * 「信封解包 / 未实现识别 / 不可达识别」三件事。
 *
 * <h2>为什么不直接复用 {@code AbstractDownstreamClient#block}</h2>
 * 父类的 {@code block()} 把所有 {@code WebClientResponseException} 一律归成
 * {@code 50000 INTERNAL_ERROR}。这对 mis-iam / mis-org 这类<b>已完工</b>的下游是够用的，
 * 但 agent-ops 的下游有 19 条端点还在 T04 排期中，打过去必然是 404/405。
 * 沿用父类会让「还没做」与「炸了」共用一个码，每一条都得有人翻日志二次分诊。
 * 因此这里自建一条链路，父类的 {@code loginContextHeaders()} / 超时语义照旧复用。
 *
 * <h2>判定顺序：先看响应体，再看状态码（顺序不可交换）</h2>
 * ai-platform 的 {@code api/response.py:error_response()} 会<b>带着非 200 状态码</b>
 * 返回完整信封，例如 {@code HTTP 404 + {"code":40400,"message":"Skill 不存在"}}。
 * 若先看状态码，「技能确实不存在」这个正常业务结果会被误报成「功能没做」——
 * 用户看到的提示从「技能不存在」变成「能力尚未实现」，比不报错更有误导性。
 * 所以恒为：
 * <ol>
 *   <li>响应体是信封 ⇒ 完全按 {@code code} 走业务语义，状态码不参与判断；</li>
 *   <li>不是信封且状态码 ∈ {404, 405, 501} ⇒ {@link DownstreamNotImplementedException}；</li>
 *   <li>不是信封且其它 4xx/5xx ⇒ {@code 50000}；</li>
 *   <li>不是信封但 2xx ⇒ 下游返回裸 JSON，原样透出（FastAPI 少数端点如此）。</li>
 * </ol>
 *
 * <h2>为什么要 {@code onStatus(s -> true, r -> Mono.empty())}</h2>
 * {@code retrieve()} 默认对 4xx/5xx 抛 {@code WebClientResponseException}，
 * 抛出时响应体只剩一个 {@code String}，还要再解析一遍、且容易在异常路径上漏读。
 * 关闭默认错误信号后，{@code toEntity(String.class)} 无论什么状态码都能拿到
 * 「状态码 + 原始体」这一对完整信息，判定逻辑集中在 {@link #interpret} 一处。
 * （{@code DefaultWebClient} 在状态处理器返回空 {@code Mono} 时会
 * {@code switchIfEmpty(body)} 继续正常解码，这是官方约定的抑制方式。）
 */
abstract class AgentOpsTransport extends AbstractDownstreamClient {

    private static final Logger log = LoggerFactory.getLogger(AgentOpsTransport.class);

    /** ai-platform backend（FastAPI），承载 §4.3 中除 #54 外的全部端点。 */
    private final WebClient backend;

    /** ai-platform gateway（Node），仅供 §4.3 #54 企微 Bot 健康探测。 */
    private final WebClient gateway;

    /** 常规超时。 */
    private final Duration normalTimeout;

    /** 对话超时（#33 背后是一次完整 LLM 推理）。 */
    private final Duration chatTimeout;

    private final ObjectMapper objectMapper;

    protected AgentOpsTransport(
            WebClient backend,
            WebClient gateway,
            long timeoutMs,
            long chatTimeoutMs,
            ObjectMapper objectMapper) {
        super(backend, timeoutMs);
        this.backend = backend;
        this.gateway = gateway;
        this.normalTimeout = Duration.ofMillis(Math.max(timeoutMs, 500));
        this.chatTimeout = Duration.ofMillis(Math.max(chatTimeoutMs, 1000));
        this.objectMapper = objectMapper;
    }

    protected ObjectMapper mapper() {
        return objectMapper;
    }

    // ------------------------------------------------------------------
    // 对外的四个动词 + 两个特例（chat 超时、gateway 基址）
    // ------------------------------------------------------------------

    protected JsonNode getJson(Function<UriBuilder, URI> uri, String downstream) {
        return exchange(backend, normalTimeout, HttpMethod.GET, uri, null, downstream);
    }

    protected JsonNode postJson(Function<UriBuilder, URI> uri, Object body, String downstream) {
        return exchange(backend, normalTimeout, HttpMethod.POST, uri, body, downstream);
    }

    protected JsonNode putJson(Function<UriBuilder, URI> uri, Object body, String downstream) {
        return exchange(backend, normalTimeout, HttpMethod.PUT, uri, body, downstream);
    }

    protected JsonNode deleteJson(Function<UriBuilder, URI> uri, String downstream) {
        return exchange(backend, normalTimeout, HttpMethod.DELETE, uri, null, downstream);
    }

    /** §4.3 #33 专用：LLM 推理耗时与其它端点不是一个量级，复用常规超时会让「消息已写入但 BFF 先超时」成为常态。 */
    protected JsonNode postChatJson(Function<UriBuilder, URI> uri, Object body, String downstream) {
        return exchange(backend, chatTimeout, HttpMethod.POST, uri, body, downstream);
    }

    /** §4.3 #54 专用：打 gateway（Node）而非 backend（FastAPI）。 */
    protected JsonNode getGatewayJson(Function<UriBuilder, URI> uri, String downstream) {
        return exchange(gateway, normalTimeout, HttpMethod.GET, uri, null, downstream);
    }

    // ------------------------------------------------------------------
    // 核心
    // ------------------------------------------------------------------

    /**
     * 下游请求头：复用基类 {@link #loginContextHeaders()} 的 MIS 上下文头
     * （X-User-Id / X-Tenant-Id / X-App-Id / X-Employee-Id / X-Username），
     * 并补上 BFF 收到的原始 MIS JWT（Authorization），使 ai-platform 的
     * {@code get_current_user} 能走 RS256 分支验签。
     *
     * <p>若无 JWT（非登录上下文 / Gateway 未透传）则不加 Authorization 头，
     * 保持与改造前一致的行为，避免对其它下游产生副作用。
     */
    private void agentOpsHeaders(HttpHeaders headers) {
        loginContextHeaders().accept(headers);
        String jwt = DownstreamAuthContext.getToken();
        if (jwt != null && !jwt.isBlank()) {
            headers.set(SecurityConstants.AUTHORIZATION_HEADER, jwt);
        }
    }

    private JsonNode exchange(
            WebClient client,
            Duration timeout,
            HttpMethod method,
            Function<UriBuilder, URI> uri,
            Object body,
            String downstream) {
        try {
            WebClient.RequestBodySpec spec = client.method(method)
                    .uri(uri)
                    .headers(this::agentOpsHeaders)
                    .accept(MediaType.APPLICATION_JSON);
            WebClient.RequestHeadersSpec<?> request = (body == null)
                    ? spec
                    : spec.contentType(MediaType.APPLICATION_JSON).bodyValue(body);
            ResponseEntity<String> entity = request.retrieve()
                    // 关闭默认错误信号：4xx/5xx 也要拿到原始响应体，交给 interpret 统一判定
                    .onStatus(status -> true, response -> Mono.empty())
                    .toEntity(String.class)
                    .block(timeout);
            return interpret(entity, downstream);
        } catch (BusinessException ex) {
            // 含 DownstreamNotImplementedException，已是最终形态，不再包装
            throw ex;
        } catch (Exception ex) {
            // 连接被拒 / DNS 失败 / 读超时：与「未实现」处置动作完全不同，必须区分
            log.warn("agent-ops 下游不可达: {} — {}", downstream, ex.toString());
            throw new BusinessException(
                    AgentOpsErrorCodes.DOWNSTREAM_UNAVAILABLE,
                    "下游不可达：" + downstream + " — " + rootMessage(ex));
        }
    }

    private JsonNode interpret(ResponseEntity<String> entity, String downstream) {
        if (entity == null) {
            throw new BusinessException(
                    AgentOpsErrorCodes.DOWNSTREAM_UNAVAILABLE, "下游无响应：" + downstream);
        }
        int status = entity.getStatusCode().value();
        String raw = entity.getBody();
        JsonNode parsed = parseOrNull(raw);

        if (isEnvelope(parsed)) {
            int code = parsed.get("code").asInt();
            if (code == ResultCode.SUCCESS.getCode()) {
                JsonNode data = parsed.get("data");
                return data == null ? NullNode.getInstance() : data;
            }
            String message = parsed.path("message").asText("下游返回失败");
            JsonNode data = parsed.get("data");
            // data 一并带走：下游塞进错误响应的结构化明细是给前端用的，在这一跳丢掉就再也拿不回来
            throw new BusinessException(code, message, (data == null || data.isNull()) ? null : data);
        }

        if (status == 404 || status == 405 || status == 501) {
            throw new DownstreamNotImplementedException(downstream);
        }
        if (status >= 400) {
            log.warn("agent-ops 下游返回非信封错误: {} HTTP {} body={}", downstream, status, abbreviate(raw));
            throw new BusinessException(
                    ResultCode.INTERNAL_ERROR, "下游调用失败：" + downstream + " HTTP " + status);
        }
        // 2xx 但不是信封：下游直接吐裸 JSON，原样透出
        return parsed == null ? NullNode.getInstance() : parsed;
    }

    /**
     * 信封判定刻意从严：必须是<b>对象</b>、有<b>数值型</b> {@code code}、且至少带
     * {@code data} 或 {@code message} 之一。
     *
     * <p>只判 {@code has("code")} 会误伤业务数据 —— 例如某个下游返回
     * {@code {"code":"SKU-001","name":"..."}}（业务字段恰好叫 code），
     * 会被当成 {@code code} 非 0 的失败信封，把一次正常响应变成异常。
     */
    private static boolean isEnvelope(JsonNode node) {
        if (node == null || !node.isObject()) {
            return false;
        }
        JsonNode code = node.get("code");
        if (code == null || !code.isNumber()) {
            return false;
        }
        return node.has("data") || node.has("message");
    }

    private JsonNode parseOrNull(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readTree(raw);
        } catch (Exception ex) {
            return null;
        }
    }

    private static String rootMessage(Throwable ex) {
        Throwable cursor = ex;
        while (cursor.getCause() != null && cursor.getCause() != cursor) {
            cursor = cursor.getCause();
        }
        String message = cursor.getMessage();
        return (message == null || message.isBlank()) ? cursor.getClass().getSimpleName() : message;
    }

    private static String abbreviate(String raw) {
        if (raw == null) {
            return "<empty>";
        }
        return raw.length() <= 300 ? raw : raw.substring(0, 300) + "...";
    }
}
