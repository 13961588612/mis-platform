package com.mis.adminbff.dto.ai;

import java.util.List;

/**
 * {@code GET /api/v1/ai/health} 响应 data。
 */
public class AiHealthResponse {

    /** AI 平台是否可达（熔断降级依据）。 */
    private boolean platformUp;

    /** 最近一次健康探测延迟（毫秒）。 */
    private long latencyMs;

    /** 当前开通的 capability 名称列表（chat/summary/extract/rag 等）。 */
    private List<String> enabledCapabilities = List.of();

    public boolean isPlatformUp() {
        return platformUp;
    }

    public void setPlatformUp(boolean platformUp) {
        this.platformUp = platformUp;
    }

    public long getLatencyMs() {
        return latencyMs;
    }

    public void setLatencyMs(long latencyMs) {
        this.latencyMs = latencyMs;
    }

    public List<String> getEnabledCapabilities() {
        return enabledCapabilities;
    }

    public void setEnabledCapabilities(List<String> enabledCapabilities) {
        this.enabledCapabilities = enabledCapabilities;
    }
}
