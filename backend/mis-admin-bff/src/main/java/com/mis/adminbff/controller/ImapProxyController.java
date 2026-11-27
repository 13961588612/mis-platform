package com.mis.adminbff.controller;

import com.mis.adminbff.config.ImapProperties;
import com.mis.adminbff.support.DownstreamAuthContext;
import com.mis.adminbff.support.IntranetAddresses;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
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
 * 室内地图 BFF 透传：{@code /api/v1/imap/**} → Nest {@code /api/v1/**}。
 * 不包第二层 Result，保持 Nest 原有 JSON。
 * <p>
 * Nest 自验 MIS JWT；若同时带 {@code X-Tenant-Id} 等网关身份头，会 403
 * （视为与 JWT claims 冲突的伪造头）。因此这里只透传 {@code Authorization}。
 */
@RestController
@RequestMapping("/api/v1/imap")
public class ImapProxyController {

    private static final Logger log = LoggerFactory.getLogger(ImapProxyController.class);
    private static final String UPSTREAM_PREFIX = "/api/v1";

    private final WebClient webClient;
    private final Duration timeout;
    private final ImapProperties properties;

    public ImapProxyController(
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainBuilder,
            ImapProperties properties) {
        this.webClient = plainBuilder.clone().baseUrl(properties.getBaseUrl()).build();
        this.timeout = Duration.ofMillis(Math.max(properties.getTimeoutMs(), 500));
        this.properties = properties;
    }

    @RequestMapping("/**")
    public ResponseEntity<String> proxy(
            HttpServletRequest request,
            @RequestBody(required = false) byte[] body) {
        if (properties.isIntranetOnly()
                && !IntranetAddresses.isIntranetClient(request, properties.getExtraAllowedCidrs())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"code\":40303,\"message\":\"室内地图仅允许内网访问\"}");
        }

        String upstreamPath = buildUpstreamPath(request.getRequestURI());
        String query = request.getQueryString();

        URI uri = UriComponentsBuilder.fromHttpUrl(properties.getBaseUrl())
                .path(upstreamPath)
                .replaceQuery(query == null || query.isBlank() ? null : query)
                .build(true)
                .toUri();

        WebClient.RequestBodySpec spec = webClient.method(HttpMethod.valueOf(request.getMethod()))
                .uri(uri)
                .headers(h -> {
                    // 禁止透传 X-User-Id / X-Tenant-Id 等：Nest + JWT 会判伪造头 → 403 → 旧 retrieve 误报 502
                    String auth = request.getHeader("Authorization");
                    if (auth == null || auth.isBlank()) {
                        auth = DownstreamAuthContext.getToken();
                    }
                    if (auth != null && !auth.isBlank()) {
                        h.set("Authorization", auth);
                    }
                });

        WebClient.RequestHeadersSpec<?> requestSpec = (body == null || body.length == 0)
                ? spec
                : spec.contentType(resolveContentType(request)).bodyValue(body);

        try {
            // 必须用 exchangeToMono：retrieve() 会把 Nest 4xx/5xx 抛成异常，被误报成 502「服务不可用」
            ResponseEntity<String> downstream = requestSpec
                    .exchangeToMono(clientResponse -> clientResponse.toEntity(String.class))
                    .block(timeout);
            if (downstream == null) {
                return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body("{\"error\":\"室内地图服务无响应\"}");
            }
            MediaType ct = downstream.getHeaders().getContentType();
            return ResponseEntity.status(downstream.getStatusCode())
                    .contentType(ct != null ? ct : MediaType.APPLICATION_JSON)
                    .body(downstream.getBody());
        } catch (Exception e) {
            Throwable root = e;
            while (root.getCause() != null && root.getCause() != root) {
                root = root.getCause();
            }
            log.warn("imap proxy failed method={} uri={} baseUrl={} err={}",
                    request.getMethod(), uri, properties.getBaseUrl(), root.toString());
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"error\":\"室内地图服务不可用\",\"detail\":\""
                            + escapeJson(root.toString())
                            + "\",\"baseUrl\":\""
                            + escapeJson(String.valueOf(properties.getBaseUrl()))
                            + "\"}");
        }
    }

    private static String escapeJson(String raw) {
        if (raw == null) {
            return "";
        }
        return raw.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static String buildUpstreamPath(String requestUri) {
        if (requestUri == null || !requestUri.startsWith("/api/v1/imap")) {
            return UPSTREAM_PREFIX;
        }
        String rest = requestUri.substring("/api/v1/imap".length());
        if (rest.isEmpty() || "/".equals(rest)) {
            return UPSTREAM_PREFIX;
        }
        return UPSTREAM_PREFIX + rest;
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
