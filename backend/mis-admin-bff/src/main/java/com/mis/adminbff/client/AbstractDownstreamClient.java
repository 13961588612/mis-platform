package com.mis.adminbff.client;

import com.mis.adminbff.config.BffProperties;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.constant.SecurityConstants;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.Result;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.function.Consumer;

abstract class AbstractDownstreamClient {

    private final WebClient webClient;
    private final Duration timeout;

    protected AbstractDownstreamClient(WebClient webClient, long timeoutMs) {
        this.webClient = webClient;
        this.timeout = Duration.ofMillis(Math.max(timeoutMs, 500));
    }

    protected WebClient client() {
        return webClient;
    }

    protected Duration timeout() {
        return timeout;
    }

    protected Consumer<org.springframework.http.HttpHeaders> operatorHeaders(Long operatorUserId) {
        return headers -> {
            if (operatorUserId != null) {
                headers.set(SecurityConstants.HEADER_USER_ID, String.valueOf(operatorUserId));
            }
        };
    }

    /** 透传 Gateway 上下文，供下游 DataScope / 操作人校验。 */
    protected Consumer<org.springframework.http.HttpHeaders> loginContextHeaders() {
        return headers -> {
            try {
                var user = com.mis.common.security.context.SecurityContextHolder.getOptional().orElse(null);
                if (user == null) {
                    return;
                }
                if (user.getUserId() != null) {
                    headers.set(SecurityConstants.HEADER_USER_ID, String.valueOf(user.getUserId()));
                }
                if (user.getTenantId() != null) {
                    headers.set(SecurityConstants.HEADER_TENANT_ID, String.valueOf(user.getTenantId()));
                }
                if (user.getAppId() != null) {
                    headers.set(SecurityConstants.HEADER_APP_ID, String.valueOf(user.getAppId()));
                }
                if (user.getEmployeeId() != null) {
                    headers.set(SecurityConstants.HEADER_EMPLOYEE_ID, String.valueOf(user.getEmployeeId()));
                }
                if (user.getUsername() != null) {
                    headers.set(SecurityConstants.HEADER_USERNAME, user.getUsername());
                }
            } catch (Exception ignored) {
                // 无安全上下文时不透传
            }
        };
    }

    protected <T> T block(Mono<Result<T>> mono) {
        try {
            Result<T> result = mono.block(timeout);
            return RequestContext.unwrap(result);
        } catch (BusinessException ex) {
            throw ex;
        } catch (WebClientResponseException ex) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR,
                    "下游调用失败: HTTP " + ex.getStatusCode().value());
        } catch (Exception ex) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "下游调用失败: " + ex.getMessage());
        }
    }

    protected void blockVoid(Mono<Result<Void>> mono) {
        block(mono);
    }

    protected <T> Mono<Result<T>> get(String uri, Object... uriVariables) {
        return webClient.get()
                .uri(uri, uriVariables)
                .retrieve()
                .bodyToMono(new ParameterizedTypeReference<Result<T>>() {});
    }

    protected <T> Mono<Result<T>> get(ParameterizedTypeReference<Result<T>> type, String uri, Object... uriVariables) {
        return webClient.get()
                .uri(uri, uriVariables)
                .retrieve()
                .bodyToMono(type);
    }

    protected <T> Mono<Result<T>> post(Object body, ParameterizedTypeReference<Result<T>> type, String uri) {
        return webClient.post()
                .uri(uri)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(type);
    }

    protected <T> Mono<Result<T>> put(Object body, ParameterizedTypeReference<Result<T>> type, String uri, Object... uriVariables) {
        return webClient.put()
                .uri(uri, uriVariables)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(type);
    }

    protected <T> Mono<Result<T>> put(
            Object body,
            ParameterizedTypeReference<Result<T>> type,
            Consumer<org.springframework.http.HttpHeaders> headers,
            String uri,
            Object... uriVariables) {
        return webClient.put()
                .uri(uri, uriVariables)
                .headers(headers)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(type);
    }

    protected Mono<Result<Void>> delete(
            Consumer<org.springframework.http.HttpHeaders> headers,
            String uri,
            Object... uriVariables) {
        return webClient.delete()
                .uri(uri, uriVariables)
                .headers(headers)
                .retrieve()
                .bodyToMono(new ParameterizedTypeReference<Result<Void>>() {});
    }

    protected Mono<Result<Void>> delete(String uri, Object... uriVariables) {
        return webClient.delete()
                .uri(uri, uriVariables)
                .retrieve()
                .bodyToMono(new ParameterizedTypeReference<Result<Void>>() {});
    }

    protected static String resolveBaseUrl(boolean discovery, String serviceId, String baseUrl) {
        if (discovery) {
            return "http://" + serviceId;
        }
        return baseUrl;
    }
}
