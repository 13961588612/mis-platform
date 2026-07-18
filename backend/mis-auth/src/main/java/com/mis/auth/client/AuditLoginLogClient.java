package com.mis.auth.client;

import com.mis.auth.config.AuthProperties;
import com.mis.auth.dto.LoginClientInfo;
import org.springframework.beans.factory.annotation.Qualifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class AuditLoginLogClient {

    private static final Logger log = LoggerFactory.getLogger(AuditLoginLogClient.class);

    private final RestClient restClient;
    private final AuthProperties authProperties;

    public AuditLoginLogClient(
            @Qualifier("plainRestClientBuilder") RestClient.Builder restClientBuilder,
            RestClient.Builder loadBalancedRestClientBuilder,
            AuthProperties authProperties) {
        this.authProperties = authProperties;
        RestClient.Builder builder = authProperties.isAuditDiscoveryEnabled()
                ? loadBalancedRestClientBuilder
                : restClientBuilder;
        this.restClient = builder.baseUrl(resolveAuditBaseUrl(authProperties)).build();
    }

    @Async
    public void recordAsync(
            Long tenantId,
            Long appId,
            Long userId,
            String username,
            int status,
            String msg,
            LoginClientInfo client) {
        if (!authProperties.isAuditEnabled()) {
            return;
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("tenantId", tenantId);
        body.put("appId", appId);
        if (userId != null) {
            body.put("userId", userId);
        }
        body.put("username", username);
        if (client != null) {
            if (client.ip() != null && !client.ip().isBlank()) {
                body.put("ip", client.ip().trim());
            }
            if (client.userAgent() != null && !client.userAgent().isBlank()) {
                body.put("userAgent", client.userAgent().trim());
            }
        }
        body.put("status", status);
        if (msg != null && !msg.isBlank()) {
            body.put("msg", msg.trim());
        }
        try {
            restClient.post()
                    .uri("/internal/v1/login-logs")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .toBodilessEntity();
        } catch (RestClientException ex) {
            log.warn("写入登录日志失败: username={}", username, ex);
        }
    }

    private static String resolveAuditBaseUrl(AuthProperties authProperties) {
        if (authProperties.isAuditDiscoveryEnabled()) {
            return "http://" + authProperties.getAuditServiceId();
        }
        return authProperties.getAuditBaseUrl();
    }
}
