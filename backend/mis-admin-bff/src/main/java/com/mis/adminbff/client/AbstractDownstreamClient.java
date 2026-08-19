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
import org.springframework.web.util.UriBuilder;
import reactor.core.publisher.Mono;

import java.net.URI;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Consumer;
import java.util.function.Function;

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

    /** 拉取非 Result 包装的原始字节（如图片代理）。 */
    protected byte[] blockBytes(Mono<byte[]> mono) {
        try {
            byte[] body = mono.block(timeout);
            if (body == null) {
                throw new BusinessException(ResultCode.INTERNAL_ERROR, "下游无响应");
            }
            return body;
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

    /**
     * 统一的带查询串 GET URI 构造（T3 收口，DEF-01/DEF-02/C-1 范式统一）。
     *
     * <p>返回一个作用在 WebClient 自身 {@link UriBuilder}（由携带 baseUrl 的
     * {@code DefaultUriBuilderFactory} 产出）上的函数，交给 {@code uri(Function)}
     * 重载：<b>编码只发生一次，且 baseUrl 的 scheme/host/port 不会丢</b>（服务发现
     * 依赖的 host=服务名也保留）。这是 {@code KbWebClient.buildUri()} /
     * {@code IamWebClient.pageUsers()} 已验证的 DEF 修复范式，本方法把同一套语义
     * 收口到基类，供各下游客户端把剩余「巧合安全」的 {@code .build(true).toUriString()}
     * 调用点替换掉。
     *
     * <p>参数以 {@code name, value, name, value, ...} 交替传入；{@code null} 与
     * 空白值一律跳过（「没传」≠「传了空值」，与旧实现 {@code queryParamIfPresent}
     * /空白过滤语义一致）。非空值以 {@code {pN}} 占位 + {@code build(Map)} 展开：
     * 值里的 {@code &}、{@code =}、花括号都被当成纯数据整体编码，既防查询串注入，
     * 也不会被误解析成 URI 模板变量。
     *
     * <p><b>不要「简化」成返回 {@link URI}</b>：{@code uri(URI)} 不经过
     * {@code uriBuilderFactory}，相对路径会丢掉 baseUrl——比双重编码更难查。
     *
     * @param path          路径（相对 baseUrl）
     * @param nameValuePairs 查询参数名值对（{@code name1, value1, name2, value2, ...}）
     * @return 供 {@code WebClient.uri(Function)} 消费的 URI 构造函数
     */
    protected static Function<UriBuilder, URI> queryUri(String path, Object... nameValuePairs) {
        return uriBuilder -> {
            uriBuilder.path(path);
            Map<String, Object> uriVariables = new LinkedHashMap<>();
            if (nameValuePairs != null) {
                for (int i = 0; i + 1 < nameValuePairs.length; i += 2) {
                    String name = String.valueOf(nameValuePairs[i]);
                    Object value = nameValuePairs[i + 1];
                    if (value == null) {
                        continue;
                    }
                    String text = String.valueOf(value);
                    if (text.isBlank()) {
                        continue;
                    }
                    String variableName = "p" + uriVariables.size();
                    uriBuilder.queryParam(name, "{" + variableName + "}");
                    uriVariables.put(variableName, text);
                }
            }
            return uriBuilder.build(uriVariables);
        };
    }

    protected static String resolveBaseUrl(boolean discovery, String serviceId, String baseUrl) {
        if (discovery) {
            return "http://" + serviceId;
        }
        return baseUrl;
    }
}
