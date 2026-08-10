package com.mis.adminbff.client;

import com.mis.adminbff.config.BffProperties;
import com.mis.common.core.result.Result;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.Map;

@Component
public class AuditWebClient extends AbstractDownstreamClient {

    private static final ParameterizedTypeReference<Result<Map<String, Long>>> COUNT =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<Void>> VOID =
            new ParameterizedTypeReference<>() {};

    public AuditWebClient(
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainBuilder,
            @Qualifier("loadBalancedWebClientBuilder") WebClient.Builder loadBalancedBuilder,
            BffProperties properties) {
        super(buildClient(plainBuilder, loadBalancedBuilder, properties), properties.getAggregateTimeoutMs());
    }

    private static WebClient buildClient(
            WebClient.Builder plainBuilder,
            WebClient.Builder loadBalancedBuilder,
            BffProperties properties) {
        WebClient.Builder builder = properties.isAuditDiscoveryEnabled() ? loadBalancedBuilder : plainBuilder;
        return builder.baseUrl(resolveBaseUrl(
                properties.isAuditDiscoveryEnabled(),
                properties.getAuditServiceId(),
                properties.getAuditBaseUrl())).build();
    }

    public long todayLoginCount(Long tenantId, Long appId) {
        Map<String, Long> data = block(client().get()
                .uri(queryUri("/internal/v1/stats/today-logins",
                        "tenantId", tenantId, "appId", appId))
                .retrieve()
                .bodyToMono(COUNT));
        return data != null && data.get("count") != null ? data.get("count") : 0L;
    }

    public void createOperLog(Map<String, Object> body) {
        try {
            blockVoid(post(body, VOID, "/internal/v1/oper-logs"));
        } catch (Exception ignored) {
            // 审计失败不阻断业务
        }
    }
}
