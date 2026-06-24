package com.mis.gateway.filter;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.common.core.constant.SecurityConstants;
import com.mis.common.security.jwt.JwtTestSupport;
import com.mis.gateway.config.GatewaySecurityProperties;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class JwtAuthenticationGlobalFilterTest {

    private final JwtAuthenticationGlobalFilter filter = new JwtAuthenticationGlobalFilter(
            JwtTestSupport.verifier(),
            jti -> false,
            new GatewaySecurityProperties(),
            new ObjectMapper());

    @Test
    void whitelistedPathDoesNotRequireToken() {
        MockServerHttpRequest request = MockServerHttpRequest.get("/actuator/health").build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);
        AtomicReference<ServerWebExchange> forwarded = new AtomicReference<>();

        StepVerifier.create(filter.filter(exchange, ex -> {
                    forwarded.set(ex);
                    return Mono.empty();
                }))
                .verifyComplete();

        assertThat(forwarded.get()).isNotNull();
        assertThat(forwarded.get().getRequest().getHeaders().getFirst(SecurityConstants.HEADER_TRACE_ID))
                .isNotBlank();
    }

    @Test
    void addsIdentityHeadersAfterVerification() {
        String token = JwtTestSupport.accessToken(1001L, 1L, 1L, 2001L, "admin");
        MockServerHttpRequest request = MockServerHttpRequest.get("/api/v1/users")
                .header(HttpHeaders.AUTHORIZATION, SecurityConstants.BEARER_PREFIX + token)
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);
        AtomicReference<ServerWebExchange> forwarded = new AtomicReference<>();

        StepVerifier.create(filter.filter(exchange, ex -> {
                    forwarded.set(ex);
                    return Mono.empty();
                }))
                .verifyComplete();

        assertThat(forwarded.get()).isNotNull();
        assertThat(forwarded.get().getRequest().getHeaders().getFirst(SecurityConstants.HEADER_USER_ID))
                .isEqualTo("1001");
        assertThat(forwarded.get().getRequest().getHeaders().getFirst(SecurityConstants.HEADER_TENANT_ID))
                .isEqualTo("1");
        assertThat(forwarded.get().getRequest().getHeaders().getFirst(SecurityConstants.HEADER_APP_ID))
                .isEqualTo("1");
        assertThat(forwarded.get().getRequest().getHeaders().getFirst(SecurityConstants.HEADER_EMPLOYEE_ID))
                .isEqualTo("2001");
        assertThat(forwarded.get().getRequest().getHeaders().getFirst(SecurityConstants.HEADER_USERNAME))
                .isEqualTo("admin");
    }

    @Test
    void rejectsMissingToken() {
        MockServerHttpRequest request = MockServerHttpRequest.get("/api/v1/users").build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        StepVerifier.create(filter.filter(exchange, ex -> Mono.empty()))
                .verifyComplete();

        assertThat(exchange.getResponse().getStatusCode().value()).isEqualTo(401);
    }
}
