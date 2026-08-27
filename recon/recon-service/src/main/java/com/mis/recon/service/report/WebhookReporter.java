package com.mis.recon.service.report;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.recon.util.JsonUtil;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;

/**
 * Webhook 渠道（F101，T07-spec §3.3）：POST JSON 到 content.configJson.url，未配置降级应用级
 * mis.recon.notify.webhook.url；两处均未配置 → 日志模拟成功（dev 期 mock）。
 */
@Slf4j
@Component
public class WebhookReporter implements Reporter {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final RestClient restClient;
    private final String appDefaultUrl;

    public WebhookReporter(RestClient.Builder builder,
                           @Value("${mis.recon.notify.webhook.url:}") String appDefaultUrl) {
        this.restClient = builder.build();
        this.appDefaultUrl = appDefaultUrl;
    }

    @Override
    public String channel() {
        return "webhook";
    }

    @Override
    public SendResult send(ReportContent content) {
        String url = resolveUrl(content);
        if (!StringUtils.hasText(url)) {
            log.info("[report][webhook] no url configured, mock send: title={}", content.getTitle());
            return SendResult.ok();
        }
        String payload = buildPayload(content);
        try {
            restClient.post()
                    .uri(url)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(payload)
                    .retrieve()
                    .toBodilessEntity();
            log.info("[report][webhook] posted url={} title={}", url, content.getTitle());
            return SendResult.ok();
        } catch (Exception e) {
            log.warn("[report][webhook] send failed url={}: {}", url, e.getMessage());
            return SendResult.fail(e.getMessage());
        }
    }

    private String resolveUrl(ReportContent content) {
        String cfg = content.getConfigJson();
        if (StringUtils.hasText(cfg)) {
            JsonNode node = JsonUtil.parse(cfg);
            if (node != null && node.hasNonNull("url") && node.get("url").isTextual()) {
                String url = node.get("url").asText();
                if (StringUtils.hasText(url)) {
                    return url;
                }
            }
        }
        return appDefaultUrl;
    }

    private String buildPayload(ReportContent content) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("scenarioCode", content.getScenarioCode());
        root.put("checkName", content.getCheckName());
        root.put("title", content.getTitle());
        root.put("severity", content.getSeverity());
        root.put("body", content.getBody());
        return JsonUtil.toString(root);
    }
}