package com.mis.adminbff.dto.ai;

import java.util.List;
import java.util.Map;

/**
 * {@code POST /api/v1/ai/extract} 请求体（表单信息抽取）。
 */
public class AiExtractRequest {

    /** 能力标识（如 form-fill）。 */
    private String capability;

    /** 待抽取的非结构化文本。 */
    private String text;

    /** 抽取 schema：{ fields: [ { name, type }, ... ] }。 */
    private Map<String, Object> schema = Map.of();

    /** 页面上下文（bizType 等）。 */
    private Map<String, Object> context = Map.of();

    public String getCapability() {
        return capability;
    }

    public void setCapability(String capability) {
        this.capability = capability;
    }

    public String getText() {
        return text;
    }

    public void setText(String text) {
        this.text = text;
    }

    public Map<String, Object> getSchema() {
        return schema;
    }

    public void setSchema(Map<String, Object> schema) {
        this.schema = schema;
    }

    public Map<String, Object> getContext() {
        return context;
    }

    public void setContext(Map<String, Object> context) {
        this.context = context;
    }
}
