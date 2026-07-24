package com.mis.adminbff.dto.ai;

import java.util.List;

/**
 * {@code POST /api/v1/ai/summary} 响应 data。
 *
 * <p>由平台 mis-summary Agent 返回的结构化 JSON 解析而来。
 *
 * <p>T-sum（阶段5 后端扩展）：新增 {@code summary} 自然语言摘要文本；{@code points} /
 * {@code citations} 由旧 {@code List<String>} 升级为结构化 {@link SummaryPoint} /
 * {@link SummaryCitation}（保留 {@code text} 兼容旧纯文本形态）。
 */
public class AiSummaryResponse {

    /** 一段自然语言摘要文本。 */
    private String summary;

    /** 结构化摘要要点列表（label / value / risk）。 */
    private List<SummaryPoint> points = List.of();

    /** 结构化引用溯源列表（field / value / source）。 */
    private List<SummaryCitation> citations = List.of();

    /** 实际使用的模型名（来自平台响应）。 */
    private String model;

    /** 平台会话 ID。 */
    private String sessionId;

    public String getSummary() {
        return summary;
    }

    public void setSummary(String summary) {
        this.summary = summary;
    }

    public List<SummaryPoint> getPoints() {
        return points;
    }

    public void setPoints(List<SummaryPoint> points) {
        this.points = points;
    }

    public List<SummaryCitation> getCitations() {
        return citations;
    }

    public void setCitations(List<SummaryCitation> citations) {
        this.citations = citations;
    }

    public String getModel() {
        return model;
    }

    public void setModel(String model) {
        this.model = model;
    }

    public String getSessionId() {
        return sessionId;
    }

    public void setSessionId(String sessionId) {
        this.sessionId = sessionId;
    }
}
