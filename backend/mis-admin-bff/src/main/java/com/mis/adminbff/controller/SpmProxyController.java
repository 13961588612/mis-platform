package com.mis.adminbff.controller;

import com.mis.adminbff.client.AbstractDownstreamClient;
import com.mis.adminbff.config.SpmProperties;
import com.mis.adminbff.support.IntranetAddresses;
import jakarta.servlet.http.HttpServletRequest;
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
 * 超市运营 BFF 透传：{@code /api/v1/spm/**} → spm-service {@code /internal/v1/spm/**}。
 * 不包第二层 Result。默认仅内网客户端可调用。
 */
@RestController
@RequestMapping("/api/v1/spm")
public class SpmProxyController {

    private static final String UPSTREAM_PREFIX = "/internal/v1/spm";

    private final WebClient webClient;
    private final Duration timeout;
    private final SpmProperties properties;

    public SpmProxyController(
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainBuilder,
            SpmProperties properties) {
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
                    .body("{\"code\":40303,\"message\":\"超市运营仅允许内网访问\"}");
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
                .headers(AbstractDownstreamClient.loginContextHeadersStatic());

        WebClient.RequestHeadersSpec<?> requestSpec = (body == null || body.length == 0)
                ? spec
                : spec.contentType(resolveContentType(request)).bodyValue(body);

        try {
            // 与 imap 透传一致：勿用 retrieve()，否则下游 4xx 会被吞成 502
            ResponseEntity<String> downstream = requestSpec
                    .exchangeToMono(clientResponse -> clientResponse.toEntity(String.class))
                    .block(timeout);
            if (downstream == null) {
                return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body("{\"code\":1999,\"message\":\"超市运营服务无响应\"}");
            }
            return ResponseEntity.status(downstream.getStatusCode())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(downstream.getBody());
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"code\":1999,\"message\":\"超市运营服务不可用\"}");
        }
    }

    private static String buildUpstreamPath(String requestUri) {
        if (requestUri == null || !requestUri.startsWith("/api/v1/spm")) {
            return UPSTREAM_PREFIX;
        }
        return UPSTREAM_PREFIX + requestUri.substring("/api/v1/spm".length());
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
