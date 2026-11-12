package com.mis.adminbff.client;

import com.mis.adminbff.config.BankReceiptProperties;
import com.mis.adminbff.config.SmpProperties;
import com.mis.adminbff.service.smp.SmpTokenExchangeService;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.Locale;

/**
 * 将 BFF {@code /api/v1/finance/bank-account/pos-account/**} 透传至
 * {@code bip-bank-receipt} {@code /api/account-decide/**}，并附带 SMP 令牌头。
 */
@Component
public class BankReceiptClient {

    private static final Logger log = LoggerFactory.getLogger(BankReceiptClient.class);

    private static final String BFF_PREFIX = "/api/v1/finance/bank-account/pos-account";
    private static final String DOWNSTREAM_PREFIX = "/api/account-decide";

    private final BankReceiptProperties properties;
    private final SmpProperties smpProperties;
    private final SmpTokenExchangeService tokenExchange;
    private final WebClient.Builder plainWebClientBuilder;

    public BankReceiptClient(
            BankReceiptProperties properties,
            SmpProperties smpProperties,
            SmpTokenExchangeService tokenExchange,
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainWebClientBuilder) {
        this.properties = properties;
        this.smpProperties = smpProperties;
        this.tokenExchange = tokenExchange;
        this.plainWebClientBuilder = plainWebClientBuilder;
    }

    public ResponseEntity<byte[]> forward(
            HttpMethod method,
            String bffPath,
            String queryString,
            byte[] body,
            MediaType contentType,
            boolean retryOnUnauthorized) {

        Long userId = RequestContext.requireLoginUser().getUserId();
        String audience = properties.getAudience();
        String smpToken = tokenExchange.getToken(userId, audience);
        ResponseEntity<byte[]> response = doForward(method, bffPath, queryString, body, contentType, smpToken);

        if (retryOnUnauthorized && isUnauthorized(response)) {
            log.info("bip-bank-receipt 返回未授权，刷新 SMP 令牌后重试一次 userId={}", userId);
            smpToken = tokenExchange.refreshToken(userId, audience);
            response = doForward(method, bffPath, queryString, body, contentType, smpToken);
        }
        return response;
    }

    private ResponseEntity<byte[]> doForward(
            HttpMethod method,
            String bffPath,
            String queryString,
            byte[] body,
            MediaType contentType,
            String smpToken) {

        String downstreamPath = toDownstreamPath(bffPath);
        String base = trimTrailingSlash(properties.getBaseUrl());
        String uri = base + downstreamPath;
        if (StringUtils.hasText(queryString)) {
            uri = uri + "?" + queryString;
        }

        String headerName = smpProperties.getAuth().getHeaderName();
        String headerValue = smpProperties.getAuth().headerValue(smpToken);

        WebClient client = plainWebClientBuilder.build();
        WebClient.RequestBodySpec spec = client.method(method)
                .uri(uri)
                .header(headerName, headerValue)
                .accept(MediaType.ALL);

        Duration timeout = Duration.ofMillis(Math.max(properties.getReadTimeoutMs(), 5000));
        try {
            Mono<ResponseEntity<byte[]>> mono;
            if (body != null && body.length > 0
                    && method != HttpMethod.GET
                    && method != HttpMethod.HEAD) {
                MediaType ct = contentType != null ? contentType : MediaType.APPLICATION_JSON;
                mono = spec.contentType(ct)
                        .body(BodyInserters.fromResource(new ByteArrayResource(body)))
                        .exchangeToMono(r -> r.toEntity(byte[].class));
            } else {
                mono = spec.exchangeToMono(r -> r.toEntity(byte[].class));
            }
            ResponseEntity<byte[]> entity = mono.block(timeout);
            if (entity == null) {
                throw new BusinessException(ResultCode.INTERNAL_ERROR, "bip-bank-receipt 无响应");
            }
            return entity;
        } catch (BusinessException ex) {
            throw ex;
        } catch (Exception ex) {
            log.warn("bip-bank-receipt 转发失败: {} {} — {}", method, uri, ex.toString());
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "bip-bank-receipt 不可达：" + ex.getMessage());
        }
    }

    static String toDownstreamPath(String bffPath) {
        if (bffPath == null) {
            return DOWNSTREAM_PREFIX;
        }
        String path = bffPath;
        int q = path.indexOf('?');
        if (q >= 0) {
            path = path.substring(0, q);
        }
        if (path.startsWith(BFF_PREFIX)) {
            String rest = path.substring(BFF_PREFIX.length());
            if (rest.isEmpty() || "/".equals(rest)) {
                return DOWNSTREAM_PREFIX;
            }
            return DOWNSTREAM_PREFIX + rest;
        }
        throw new BusinessException(ResultCode.VALIDATION_ERROR, "非法反代路径");
    }

    private static boolean isUnauthorized(ResponseEntity<byte[]> response) {
        if (response == null) {
            return false;
        }
        int code = response.getStatusCode().value();
        if (code == 401 || code == 403) {
            return true;
        }
        byte[] body = response.getBody();
        if (body == null || body.length == 0) {
            return false;
        }
        String s = new String(body, java.nio.charset.StandardCharsets.UTF_8).toLowerCase(Locale.ROOT);
        return s.contains("\"code\":401") || s.contains("unauthorized") || s.contains("令牌");
    }

    private static String trimTrailingSlash(String url) {
        if (url == null) {
            return "";
        }
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }
}
