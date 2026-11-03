package com.mis.adminbff.client;

import com.mis.adminbff.config.AiTemplateReportProperties;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.UriBuilder;

import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * BFF → mis-ai-template-report。
 */
@Component
public class AiTemplateReportClient extends AbstractDownstreamClient {

    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<Map<String, Object>>> MAP_RESULT =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<List<Map<String, Object>>>> MAP_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<Void>> VOID_RESULT =
            new ParameterizedTypeReference<>() {};

    public AiTemplateReportClient(
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainBuilder,
            AiTemplateReportProperties properties) {
        super(plainBuilder.clone().baseUrl(properties.getBaseUrl()).build(), properties.getTimeoutMs());
    }

    public Map<String, Object> ping() {
        return block(client().get()
                .uri("/api/v1/ai-reports/ping")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    public List<Map<String, Object>> categoryTree() {
        return block(client().get()
                .uri("/api/v1/ai-reports/categories/tree")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_LIST));
    }

    public Map<String, Object> createCategory(Object body) {
        return block(client().post()
                .uri("/api/v1/ai-reports/categories")
                .headers(loginContextHeaders())
                .bodyValue(body)
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    public Map<String, Object> updateCategory(Long id, Object body) {
        return block(client().put()
                .uri("/api/v1/ai-reports/categories/{id}", id)
                .headers(loginContextHeaders())
                .bodyValue(body)
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    public void deleteCategory(Long id) {
        blockVoid(client().delete()
                .uri("/api/v1/ai-reports/categories/{id}", id)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(VOID_RESULT));
    }

    public List<Map<String, Object>> listParamSources() {
        return block(client().get()
                .uri("/api/v1/ai-reports/param-sources")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_LIST));
    }

    public List<Map<String, Object>> listWorkflowPlatforms() {
        return block(client().get()
                .uri("/api/v1/ai-reports/workflow-platforms")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_LIST));
    }

    public Map<String, Object> createWorkflowPlatform(Object body) {
        return block(client().post()
                .uri("/api/v1/ai-reports/workflow-platforms")
                .headers(loginContextHeaders())
                .bodyValue(body)
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    public Map<String, Object> updateWorkflowPlatform(Long id, Object body) {
        return block(client().put()
                .uri("/api/v1/ai-reports/workflow-platforms/{id}", id)
                .headers(loginContextHeaders())
                .bodyValue(body)
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    public List<Map<String, Object>> listReports(Long categoryId, boolean uncategorized) {
        Function<UriBuilder, java.net.URI> uri = b -> {
            UriBuilder ub = b.path("/api/v1/ai-reports/defs");
            if (uncategorized) {
                ub = ub.queryParam("uncategorized", true);
            } else if (categoryId != null) {
                ub = ub.queryParam("categoryId", categoryId);
            }
            return ub.build();
        };
        return block(client().get()
                .uri(uri)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_LIST));
    }

    public Map<String, Object> getReport(Long id) {
        return block(client().get()
                .uri("/api/v1/ai-reports/defs/{id}", id)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    public Map<String, Object> createReport(Object body) {
        return block(client().post()
                .uri("/api/v1/ai-reports/defs")
                .headers(loginContextHeaders())
                .bodyValue(body)
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    public Map<String, Object> updateReport(Long id, Object body) {
        return block(client().put()
                .uri("/api/v1/ai-reports/defs/{id}", id)
                .headers(loginContextHeaders())
                .bodyValue(body)
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    public void deleteReport(Long id) {
        blockVoid(client().delete()
                .uri("/api/v1/ai-reports/defs/{id}", id)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(VOID_RESULT));
    }

    public List<Map<String, Object>> listAcls(String reportCode) {
        return block(client().get()
                .uri(b -> b.path("/api/v1/ai-reports/acls").queryParam("reportCode", reportCode).build())
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_LIST));
    }

    public Map<String, Object> createAcl(Object body) {
        return block(client().post()
                .uri("/api/v1/ai-reports/acls")
                .headers(loginContextHeaders())
                .bodyValue(body)
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    public void deleteAcl(Long id) {
        blockVoid(client().delete()
                .uri("/api/v1/ai-reports/acls/{id}", id)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(VOID_RESULT));
    }
}
