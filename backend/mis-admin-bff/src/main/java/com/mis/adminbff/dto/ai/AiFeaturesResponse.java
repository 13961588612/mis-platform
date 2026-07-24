package com.mis.adminbff.dto.ai;

import java.util.Map;

/**
 * {@code GET /api/v1/ai/features} 响应 data（前端按此显隐 AI 能力入口）。
 *
 * <p>Q1（阶段5 后端扩展）：新增 {@code config} 下发前端运行期配置，目前含
 * {@code config.form-fill.confThreshold}（表单低置信强制确认阈值，默认 0.85，可配）。
 * BFF 仅下发该阈值，不判定阈值（阈值仅前端用于标红 / HITL）。
 */
public class AiFeaturesResponse {

    /** 各能力是否启用：chat / summary / extract / rag / nl2sql。 */
    private Map<String, Boolean> features = Map.of();

    /** 前端运行期配置（如 form-fill.confThreshold）。 */
    private Map<String, Object> config = Map.of();

    public Map<String, Boolean> getFeatures() {
        return features;
    }

    public void setFeatures(Map<String, Boolean> features) {
        this.features = features;
    }

    public Map<String, Object> getConfig() {
        return config;
    }

    public void setConfig(Map<String, Object> config) {
        this.config = config;
    }
}
