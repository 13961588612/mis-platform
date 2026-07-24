package com.mis.adminbff.dto.ai;

import java.util.List;
import java.util.Map;

/**
 * {@code POST /api/v1/ai/summary} 请求体。
 *
 * @see com.mis.adminbff.service.AiCapabilityTranslator
 */
public class AiSummaryRequest {

    /** 能力标识（如 detail-summary），透传给平台 metadata.capability。 */
    private String capability;

    /** 业务记录列表（脱敏后），由平台 Agent 汇总为要点。 */
    private List<Map<String, Object>> records = List.of();

    /** 页面上下文（bizType / pageId / locale 等）。 */
    private Map<String, Object> context = Map.of();

    /** 可选控制项（maxPoints / tone 等）。 */
    private Map<String, Object> options = Map.of();

    public String getCapability() {
        return capability;
    }

    public void setCapability(String capability) {
        this.capability = capability;
    }

    public List<Map<String, Object>> getRecords() {
        return records;
    }

    public void setRecords(List<Map<String, Object>> records) {
        this.records = records;
    }

    public Map<String, Object> getContext() {
        return context;
    }

    public void setContext(Map<String, Object> context) {
        this.context = context;
    }

    public Map<String, Object> getOptions() {
        return options;
    }

    public void setOptions(Map<String, Object> options) {
        this.options = options;
    }
}
