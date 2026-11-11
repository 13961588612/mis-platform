package com.mis.aireport.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.mis.aireport.config.BailianProperties;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 同步调用阿里百炼应用 completion（非流式）。不引入 DashScope SDK。
 */
@Component
public class BailianAppClient {

    private static final Logger log = LoggerFactory.getLogger(BailianAppClient.class);

    private final RestClient client;
    private final BailianProperties properties;

    /** 仅此构造器给 Spring 注入；另有测试用双参构造器，必须标明 @Autowired。 */
    @Autowired
    public BailianAppClient(BailianProperties properties) {
        this(buildClient(properties), properties);
    }

    /** 测试用：注入已绑定 Mock 的 RestClient。 */
    BailianAppClient(RestClient client, BailianProperties properties) {
        this.client = client;
        this.properties = properties;
    }

    private static RestClient buildClient(BailianProperties properties) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(10));
        int readSec = Math.max(30, properties.getTimeoutSeconds());
        factory.setReadTimeout(Duration.ofSeconds(readSec));
        String base = properties.getBaseUrl() == null ? "https://dashscope.aliyuncs.com" : properties.getBaseUrl().trim();
        if (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        return RestClient.builder().baseUrl(base).requestFactory(factory).build();
    }

    /**
     * POST /api/v1/apps/{appId}/completion，返回 output.text。
     *
     * @param appId  报告定义上的 workflow_key
     * @param prompt 已渲染提示词
     */
    public String complete(String appId, String prompt) {
        if (!StringUtils.hasText(properties.getApiKey())) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "平台未配置阿里百炼 API Key（MIS_BAILIAN_API_KEY）");
        }
        if (!StringUtils.hasText(appId)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "缺少百炼应用 APP_ID（workflow_key）");
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("input", Map.of("prompt", prompt == null ? "" : prompt));
        body.put("parameters", Map.of());
        body.put("debug", Map.of());

        long t0 = System.nanoTime();
        try {
            CompletionResponse resp = client.post()
                    .uri("/api/v1/apps/{appId}/completion", appId.trim())
                    .contentType(MediaType.APPLICATION_JSON)
                    .headers(h -> {
                        h.setBearerAuth(properties.getApiKey().trim());
                        if (StringUtils.hasText(properties.getWorkspace())) {
                            h.set("X-DashScope-WorkSpace", properties.getWorkspace().trim());
                        }
                    })
                    .body(body)
                    .retrieve()
                    .body(CompletionResponse.class);
            long ms = (System.nanoTime() - t0) / 1_000_000;
            String text = resp == null || resp.output() == null ? null : resp.output().text();
            String requestId = resp == null ? null : resp.requestId();
            log.info("bailian completion ok appId={} requestId={} elapsedMs={}", appId.trim(), requestId, ms);
            if (!StringUtils.hasText(text)) {
                throw new BusinessException(ResultCode.INTERNAL_ERROR, "阿里百炼未返回正文");
            }
            return text.trim();
        } catch (BusinessException ex) {
            throw ex;
        } catch (RestClientResponseException ex) {
            long ms = (System.nanoTime() - t0) / 1_000_000;
            log.warn("bailian completion http error appId={} status={} elapsedMs={}",
                    appId.trim(), ex.getStatusCode().value(), ms);
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "阿里百炼工作流调用失败");
        } catch (Exception ex) {
            long ms = (System.nanoTime() - t0) / 1_000_000;
            log.warn("bailian completion failed appId={} elapsedMs={}: {}",
                    appId.trim(), ms, ex.getMessage());
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "阿里百炼工作流调用失败");
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record CompletionResponse(
            Output output,
            @JsonProperty("request_id") String requestId) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Output(String text) {
    }
}
