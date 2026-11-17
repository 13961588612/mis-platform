package com.mis.adminbff.controller;

import com.mis.adminbff.client.AbstractDownstreamClient;
import com.mis.adminbff.config.ReconProperties;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.time.Duration;

/**
 * 对账平台（recon）BFF 透传端点。
 *
 * <p><b>为什么是通用透传而不是逐端点映射</b>：recon-service 是独立成熟的业务系统
 * （连接/数据源/场景/check/diff/报表 11 个 Controller 数十端点），BFF 对它
 * <b>零加工</b>——既不聚合、也不翻译字段，只是把平台侧 {@code /api/v1/recon/**}
 * 原样转发到内网 {@code /internal/v1/recon/**}。逐端点写 WebClient 方法等于
 * 把 recon 的接口清单在 BFF 里复制一份，每次 recon 加端点都要同步改 BFF，
 * 违背「BFF 不参与的端点一律原样转发」的透传策略（与 AgentOps 的
 * {@code Result<JsonNode>} 语义一致，只是这里连信封都不拆）。
 *
 * <p><b>判权</b>：本类所有端点位于 {@code /api/v1/**}，由
 * {@link com.mis.common.security.permission.ApiPermissionInterceptor} 统一拦截。
 * recon 端点在 {@code sys_api} 注册为 {@code authOnly}（仅登录即可访问），
 * 按钮级权限仍由前端 PermissionGate 基于壳子下发的 permissions 控制
 * （与方案 A 决策一致：BFF 只保证「已登录」，不做按钮级 API 鉴权）。
 *
 * <p><b>响应原样透传</b>：recon-service 返回自己的信封
 * {@code {code, data, message}}（HTTP 恒 200），前端 client.ts 已按此解包。
 * BFF 若再包一层 {@code Result} 会让前端拿到 {@code {code:0, data:{code, data, message}}}，
 * 解包链断裂。故这里<b>不包 Result</b>，原样回传下游 status + body。
 */
@RestController
@RequestMapping("/api/v1/recon")
public class ReconProxyController {

    private static final String UPSTREAM_PREFIX = "/internal/v1/recon";

    private final WebClient webClient;
    private final Duration timeout;
    private final ReconProperties properties;

    public ReconProxyController(
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainBuilder,
            ReconProperties properties) {
        this.webClient = plainBuilder.clone().baseUrl(properties.getBaseUrl()).build();
        this.timeout = Duration.ofMillis(Math.max(properties.getTimeoutMs(), 500));
        this.properties = properties;
    }

    /**
     * 通用透传：捕获 {@code /api/v1/recon/**} 全部方法与子路径。
     *
     * <p>路径映射规则：{@code /api/v1/recon/xxx} → {@code /internal/v1/recon/xxx}。
     * query string 原样带上；body（POST/PUT）原样转发；请求上下文头
     * （X-User-Id / X-Tenant-Id 等）由 {@link AbstractDownstreamClient#loginContextHeaders()}
     * 透传，供 recon-service 未来做操作人/数据权限时使用。
     *
     * <p><b>query 透传必须防二次编码</b>：入站 query 是前端已编码的（如中文 checkName
     * {@code %E5%82%A8...}）。不能走 {@code uriBuilder.replaceQuery(query)} + 默认
     * {@code DefaultUriBuilderFactory}（TEMPLATE_AND_VALUES 会把 {@code %} 再编码成
     * {@code %25}，中文参数到下游变乱码，参见 KbWebClientUriEncodingTest）。
     * 这里把 baseUrl + 路径 + 已编码 query 拼成绝对 URI 后 {@code build(true)}（视输入
     * 为已编码，不再二次编码），再用 {@code uri(URI)} 直接发送（绝对地址不丢 baseUrl）。</p>
     */
    @RequestMapping("/**")
    public ResponseEntity<String> proxy(
            HttpServletRequest request,
            @RequestBody(required = false) byte[] body) {
        String upstreamPath = buildUpstreamPath(request.getRequestURI());
        String query = request.getQueryString();

        URI uri = UriComponentsBuilder.fromHttpUrl(properties.getBaseUrl())
                .path(upstreamPath)
                .replaceQuery(query == null || query.isBlank() ? null : query)
                .build(true)
                .toUri();

        WebClient.RequestBodySpec spec = webClient.method(HttpMethod.valueOf(request.getMethod()))
                .uri(uri)
                .headers(AbstractDownstreamClient.loginContextHeadersStatic());

        WebClient.RequestHeadersSpec<?> requestSpec = (body == null || body.length == 0)
                ? spec
                : spec.contentType(resolveContentType(request)).bodyValue(body);

        ResponseEntity<String> downstream = requestSpec
                .retrieve()
                .toEntity(String.class)
                .block(timeout);
        if (downstream == null) {
            return ResponseEntity.status(502).body("{\"code\":1999,\"message\":\"对账平台无响应\"}");
        }
        return ResponseEntity.status(downstream.getStatusCode())
                .contentType(MediaType.APPLICATION_JSON)
                .body(downstream.getBody());
    }

    /** {@code /api/v1/recon/xxx} → {@code /internal/v1/recon/xxx}。 */
    private static String buildUpstreamPath(String requestUri) {
        if (requestUri == null || !requestUri.startsWith("/api/v1/recon")) {
            return UPSTREAM_PREFIX;
        }
        return UPSTREAM_PREFIX + requestUri.substring("/api/v1/recon".length());
    }

    private static MediaType resolveContentType(HttpServletRequest request) {
        String contentType = request.getContentType();
        if (contentType != null && !contentType.isBlank()) {
            try {
                return MediaType.parseMediaType(contentType);
            } catch (Exception ignored) {
                // 非法 Content-Type 降级 JSON
            }
        }
        return MediaType.APPLICATION_JSON;
    }
}
