package com.mis.adminbff.client;

import com.mis.adminbff.config.BffProperties;
import com.mis.common.core.result.Result;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.Map;

@Component
public class AuthWebClient extends AbstractDownstreamClient {

    private static final ParameterizedTypeReference<Result<Map<String, Long>>> COUNT =
            new ParameterizedTypeReference<>() {};

    public AuthWebClient(
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainBuilder,
            @Qualifier("loadBalancedWebClientBuilder") WebClient.Builder loadBalancedBuilder,
            BffProperties properties) {
        super(buildClient(plainBuilder, loadBalancedBuilder, properties), properties.getAggregateTimeoutMs());
    }

    private static WebClient buildClient(
            WebClient.Builder plainBuilder,
            WebClient.Builder loadBalancedBuilder,
            BffProperties properties) {
        WebClient.Builder builder = properties.isAuthDiscoveryEnabled() ? loadBalancedBuilder : plainBuilder;
        return builder.baseUrl(resolveBaseUrl(
                properties.isAuthDiscoveryEnabled(),
                properties.getAuthServiceId(),
                properties.getAuthBaseUrl())).build();
    }

    public long onlineUserCount(Long appId) {
        Map<String, Long> data = block(client().get()
                .uri(queryUri("/internal/v1/stats/online-users", "appId", appId))
                .retrieve()
                .bodyToMono(COUNT));
        return data != null && data.get("count") != null ? data.get("count") : 0L;
    }
}
