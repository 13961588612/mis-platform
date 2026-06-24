package com.mis.gateway.filter;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.common.core.constant.SecurityConstants;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.Result;
import com.mis.common.core.util.TraceIdUtils;
import com.mis.common.security.jwt.JwtAuthenticationException;
import com.mis.common.security.jwt.JwtClaims;
import com.mis.common.security.jwt.JwtVerifier;
import com.mis.common.security.jwt.TokenBlacklistChecker;
import com.mis.gateway.config.GatewaySecurityProperties;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * Gateway <b>L1 认证</b>全局过滤器（WebFlux）。
 * <p>
 * <b>职责边界</b>（见 {@code docs/architecture/03-security.md}）：
 * <ul>
 *   <li>做：JWT RS256 验签、Redis jti 黑名单、向后续服务透传身份头</li>
 *   <li>不做：API 权限判断（由 BFF 读 Redis permissions 完成）</li>
 * </ul>
 * <p>
 * <b>处理流程</b>：
 * <ol>
 *   <li>补全或生成 {@link SecurityConstants#HEADER_TRACE_ID}</li>
 *   <li>白名单路径（login/refresh/captcha/actuator）直接放行</li>
 *   <li>校验 {@code Authorization: Bearer}，{@link JwtVerifier#verify(String)}</li>
 *   <li>异步查 {@link TokenBlacklistChecker}（阻塞 Redis 走 boundedElastic，避免卡 Netty 事件循环）</li>
 *   <li>成功则写入 {@code X-User-Id} 等头，下游 Servlet 服务由 {@code GatewayContextFilter} 解析</li>
 * </ol>
 * <p>
 * 注册条件：{@code mis.security.jwt.public-key-*} 已配置且 {@code mis.security.gateway.enabled=true}。
 *
 * @see com.mis.gateway.config.GatewaySecurityConfiguration
 */
public class JwtAuthenticationGlobalFilter implements GlobalFilter, Ordered {

    private final JwtVerifier jwtVerifier;
    private final TokenBlacklistChecker tokenBlacklistChecker;
    private final GatewaySecurityProperties gatewaySecurityProperties;
    private final ObjectMapper objectMapper;

    public JwtAuthenticationGlobalFilter(
            JwtVerifier jwtVerifier,
            TokenBlacklistChecker tokenBlacklistChecker,
            GatewaySecurityProperties gatewaySecurityProperties,
            ObjectMapper objectMapper) {
        this.jwtVerifier = jwtVerifier;
        this.tokenBlacklistChecker = tokenBlacklistChecker;
        this.gatewaySecurityProperties = gatewaySecurityProperties;
        this.objectMapper = objectMapper;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest();
        String path = request.getPath().pathWithinApplication().value();

        // 全链路 TraceId：客户端可传入，否则 Gateway 生成
        String headerTraceId = request.getHeaders().getFirst(SecurityConstants.HEADER_TRACE_ID);
        final String traceId = (headerTraceId == null || headerTraceId.isBlank())
                ? TraceIdUtils.generate()
                : headerTraceId;

        // 白名单：仅认证相关公开接口，仍注入 TraceId
        if (gatewaySecurityProperties.isWhitelisted(request.getMethod(), path)) {
            ServerHttpRequest mutated = request.mutate()
                    .header(SecurityConstants.HEADER_TRACE_ID, traceId)
                    .build();
            return chain.filter(exchange.mutate().request(mutated).build());
        }

        String authorization = request.getHeaders().getFirst(HttpHeaders.AUTHORIZATION);
        if (authorization == null || !authorization.startsWith(SecurityConstants.BEARER_PREFIX)) {
            return writeError(exchange, ResultCode.UNAUTHORIZED, "Missing or invalid Authorization header", traceId);
        }

        String token = authorization.substring(SecurityConstants.BEARER_PREFIX.length()).trim();
        try {
            JwtClaims claims = jwtVerifier.verify(token);

            // 登出后 mis-auth 将 jti 写入 Redis；此处拒绝仍有效但未过期的 Access Token
            if (claims.jti() != null) {
                return Mono.fromCallable(() -> tokenBlacklistChecker.isBlacklisted(claims.jti()))
                        .subscribeOn(Schedulers.boundedElastic())
                        .flatMap(blacklisted -> {
                            if (blacklisted) {
                                return writeError(exchange, ResultCode.TOKEN_INVALID, "Token revoked", traceId);
                            }
                            return forwardWithClaims(exchange, chain, request, traceId, claims);
                        });
            }
            return forwardWithClaims(exchange, chain, request, traceId, claims);
        } catch (JwtAuthenticationException ex) {
            return writeError(exchange, ex.getResultCode(), ex.getMessage(), traceId);
        }
    }

    /**
     * 将 JWT 中的身份字段转为 HTTP 头，供 BFF / 领域服务信任（Gateway 已验签）。
     * <p>
     * 注意：不透传 permissions；运行时权限见 ADR-009（BFF 读 Redis）。
     */
    private Mono<Void> forwardWithClaims(
            ServerWebExchange exchange,
            GatewayFilterChain chain,
            ServerHttpRequest request,
            String traceId,
            JwtClaims claims) {
        ServerHttpRequest.Builder builder = request.mutate()
                .header(SecurityConstants.HEADER_TRACE_ID, traceId);
        addHeader(builder, SecurityConstants.HEADER_USER_ID, claims.userId());
        addHeader(builder, SecurityConstants.HEADER_TENANT_ID, claims.tenantId());
        addHeader(builder, SecurityConstants.HEADER_APP_ID, claims.appId());
        addHeader(builder, SecurityConstants.HEADER_EMPLOYEE_ID, claims.employeeId());
        if (claims.username() != null) {
            builder.header(SecurityConstants.HEADER_USERNAME, claims.username());
        }
        return chain.filter(exchange.mutate().request(builder.build()).build());
    }

    @Override
    public int getOrder() {
        // 尽早执行，位于 Trace 相关过滤器之后
        return Ordered.HIGHEST_PRECEDENCE + 20;
    }

    private static void addHeader(ServerHttpRequest.Builder builder, String name, Long value) {
        if (value != null) {
            builder.header(name, String.valueOf(value));
        }
    }

    private Mono<Void> writeError(
            ServerWebExchange exchange,
            ResultCode resultCode,
            String message,
            String traceId) {
        HttpStatus status = resultCode.isAuthFailure()
                ? HttpStatus.UNAUTHORIZED
                : HttpStatus.INTERNAL_SERVER_ERROR;
        Result<Void> body = Result.fail(resultCode.getCode(), message);
        body.setTraceId(traceId);
        exchange.getResponse().setStatusCode(status);
        exchange.getResponse().getHeaders().setContentType(MediaType.APPLICATION_JSON);
        exchange.getResponse().getHeaders().set(SecurityConstants.HEADER_TRACE_ID, traceId);
        byte[] bytes;
        try {
            bytes = objectMapper.writeValueAsBytes(body);
        } catch (JsonProcessingException ex) {
            bytes = ("{\"code\":" + resultCode.getCode() + ",\"message\":\"" + message + "\"}").getBytes();
        }
        return exchange.getResponse().writeWith(Mono.just(exchange.getResponse().bufferFactory().wrap(bytes)));
    }
}
