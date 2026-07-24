package com.mis.adminbff.client;

import com.mis.adminbff.config.BffProperties;
import com.mis.common.core.result.Result;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.Map;

@Component
public class AuditWebClient extends AbstractDownstreamClient {

    private static final ParameterizedTypeReference<Result<Map<String, Long>>> COUNT =
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
        String uri = UriComponentsBuilder.fromPath("/internal/v1/stats/today-logins")
                .queryParam("tenantId", tenantId)
                .queryParam("appId", appId)
                .build(true)
                .toUriString();
        Map<String, Long> data = block(client().get().uri(uri).retrieve().bodyToMono(COUNT));
        return data != null && data.get("count") != null ? data.get("count") : 0L;
    }
}
