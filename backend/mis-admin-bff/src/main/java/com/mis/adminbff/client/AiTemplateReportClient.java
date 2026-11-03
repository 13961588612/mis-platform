package com.mis.adminbff.client;

import com.mis.adminbff.config.AiTemplateReportProperties;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.Map;

/**
 * BFF → mis-ai-template-report（S1 仅 ping；CRUD/prepare 后续扩展）。
 */
@Component
public class AiTemplateReportClient extends AbstractDownstreamClient {

    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<Map<String, Object>>> MAP_RESULT =
            new ParameterizedTypeReference<>() {};

    public AiTemplateReportClient(
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainBuilder,
            AiTemplateReportProperties properties) {
        super(plainBuilder.clone().baseUrl(properties.getBaseUrl()).build(), properties.getTimeoutMs());
    }

    /** 探活下游服务。 */
    public Map<String, Object> ping() {
        return block(client().get()
                .uri("/api/v1/ai-reports/ping")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }
}
