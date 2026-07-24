package com.mis.adminbff.service;

import com.mis.adminbff.client.AiPlatformClient;
import com.mis.adminbff.config.AiPlatformProperties;
import com.mis.adminbff.dto.ai.AiFeaturesResponse;
import com.mis.adminbff.dto.ai.AiHealthResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * AI 能力门禁与平台健康缓存（设计 §2.5）。
 *
 * <p>职责：
 * <ul>
 *   <li>持有 capability → enabled 映射（来自 {@link AiPlatformProperties}）</li>
 *   <li>定时探测 AI 平台存活并缓存（熔断降级）；探测失败则临时置为不可用</li>
 *   <li>{@link #platformAvailable()} 供写操作转发前短路，避免请求堆积</li>
 *   <li>为 {@code /api/v1/ai/health} 与 {@code /api/v1/ai/features} 提供数据</li>
 * </ul>
 */
@Service
public class AiFeatureConfigService {

    private static final Logger log = LoggerFactory.getLogger(AiFeatureConfigService.class);

    private final AiPlatformProperties properties;
    private final AiPlatformClient aiPlatformClient;

    private volatile boolean platformUp = false;
    private volatile long latencyMs = -1;
    private final AtomicLong lastCheckAt = new AtomicLong(0);

    public AiFeatureConfigService(AiPlatformProperties properties, AiPlatformClient aiPlatformClient) {
        this.properties = properties;
        this.aiPlatformClient = aiPlatformClient;
    }

    /** 定时探测平台存活（熔断降级依据）。 */
    @Scheduled(fixedDelayString = "${mis.ai-platform.health-check-interval-ms:15000}")
    public void probe() {
        if (!properties.isEnabled()) {
            platformUp = false;
            latencyMs = -1;
            return;
        }
        long start = System.currentTimeMillis();
        try {
            Map<String, Object> health = aiPlatformClient.healthProbe();
            latencyMs = System.currentTimeMillis() - start;
            platformUp = health != null
                    && "ok".equalsIgnoreCase(String.valueOf(health.get("status")));
        } catch (Exception ex) {
            platformUp = false;
            log.warn("AI platform health probe failed: {}", ex.getMessage());
        }
        lastCheckAt.set(System.currentTimeMillis());
    }

    /** AI 平台是否可用（总开关 + 存活）。写操作转发前以此短路。 */
    public boolean platformAvailable() {
        return properties.isEnabled() && platformUp;
    }

    /** 指定 capability 是否可用（配置启用 + 平台可用）。 */
    public boolean isCapabilityEnabled(String capability) {
        if (!platformAvailable()) {
            return false;
        }
        return switch (capability) {
            case "chat" -> properties.getFeatures().isChat();
            case "summary" -> properties.getFeatures().isSummary();
            case "extract" -> properties.getFeatures().isExtract();
            case "rag" -> properties.getFeatures().isRag();
            case "nl2sql" -> properties.getFeatures().isNl2sql();
            default -> false;
        };
    }

    public AiHealthResponse getHealth() {
        AiHealthResponse resp = new AiHealthResponse();
        resp.setPlatformUp(platformAvailable());
        resp.setLatencyMs(latencyMs);
        List<String> caps = new ArrayList<>();
        if (isCapabilityEnabled("chat")) {
            caps.add("chat");
        }
        if (isCapabilityEnabled("summary")) {
            caps.add("summary");
        }
        if (isCapabilityEnabled("extract")) {
            caps.add("extract");
        }
        if (isCapabilityEnabled("rag")) {
            caps.add("rag");
        }
        resp.setEnabledCapabilities(caps);
        return resp;
    }

    public AiFeaturesResponse getFeatures() {
        AiFeaturesResponse resp = new AiFeaturesResponse();
        Map<String, Boolean> features = new LinkedHashMap<>();
        features.put("chat", properties.getFeatures().isChat() && platformAvailable());
        features.put("summary", properties.getFeatures().isSummary() && platformAvailable());
        features.put("extract", properties.getFeatures().isExtract() && platformAvailable());
        features.put("rag", properties.getFeatures().isRag() && platformAvailable());
        features.put("nl2sql", properties.getFeatures().isNl2sql());
        resp.setFeatures(features);

        // Q1（T-ext）：下发表单低置信阈值，前端据此标红 / HITL；BFF 不判定阈值。
        Map<String, Object> formFill = new LinkedHashMap<>();
        formFill.put("confThreshold", properties.getFormFillConfThreshold());
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("form-fill", formFill);
        resp.setConfig(config);
        return resp;
    }
}
