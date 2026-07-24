package com.mis.adminbff.dto.ai;

import java.util.List;
import java.util.Map;

/**
 * {@code POST /api/v1/ai/extract} 响应 data。
 *
 * <p>由平台 mis-extract Agent 返回的结构化 JSON（{@code fields} / {@code confidence} /
 * {@code unmapped}）解析而来。
 *
 * <p>T-ext（阶段5 后端扩展）：{@code confidence} 由标量 {@code Double} 升级为
 * 逐字段 {@code Map<String, Double>}（键 = 前端 {@code AdminField.key}）；新增
 * {@code unmapped} 承载未映射到任何表单字段的抽取内容。
 */
public class AiExtractResponse {

    /** 抽取出的字段键值对（字段名为 schema 中定义 = 前端 AdminField.key）。 */
    private Map<String, Object> fields = Map.of();

    /**
     * 逐字段抽取置信度（0~1），键与 {@link #fields} 一一对应。
     * T-ext 前为标量 Double；升级后为对象。BFF 先上、平台仍返标量时对标本字段置 null，
     * 前端退化为「全部字段共用默认阈值」。
     */
    private Map<String, Double> confidence;

    /** 未映射到任何表单字段的抽取项（{@code raw} 原文 + 可选 {@code hint} 建议落点）。 */
    private List<Map<String, Object>> unmapped = List.of();

    /** 平台会话 ID。 */
    private String sessionId;

    public Map<String, Object> getFields() {
        return fields;
    }

    public void setFields(Map<String, Object> fields) {
        this.fields = fields;
    }

    public Map<String, Double> getConfidence() {
        return confidence;
    }

    public void setConfidence(Map<String, Double> confidence) {
        this.confidence = confidence;
    }

    public List<Map<String, Object>> getUnmapped() {
        return unmapped;
    }

    public void setUnmapped(List<Map<String, Object>> unmapped) {
        this.unmapped = unmapped;
    }

    public String getSessionId() {
        return sessionId;
    }

    public void setSessionId(String sessionId) {
        this.sessionId = sessionId;
    }
}
