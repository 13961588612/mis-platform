package com.mis.adminbff.dto.ai;

import java.util.List;
import java.util.Map;

/**
 * {@code POST /api/v1/ai/rag} 请求体（知识库问答）。
 *
 * <p>T10：新增 {@code libraryIds} / {@code sessionId} / {@code threshold}，
 * 供 mis-rag 侧 KB 问答管线（visible-libraries → retrieve → 生成 → 落库）使用。
 * 这些字段由 BFF 透传进平台 {@code metadata}，缺省时管线自行回退（全部可见库 / 新建会话 / 默认阈值）。
 */
public class AiRagRequest {

    /** 能力标识（如 kb-qa）。 */
    private String capability;

    /** 用户问题。 */
    private String question;

    /** 知识库标识（如 hr-policy）。 */
    private String kb;

    /** 页面上下文（bizType 等）。 */
    private Map<String, Object> context = Map.of();

    /** 召回条数（可选）。 */
    private Integer topK;

    /** 指定检索的知识库 ID 列表；为空表示「当前用户全部可见库」。 */
    private List<Long> libraryIds = List.of();

    /** 续聊的 mis-kb 问答会话 ID；为空表示新建会话。 */
    private Long sessionId;

    /**
     * 相关性分数阈值（0~1，可选）。
     *
     * <p><b>P0 暂无前端入口</b>——这是产品决策（不向普通用户暴露调参 UI），<b>不是契约断链</b>。
     * 缺省时由 mis-rag 侧按「全局默认 → 库设置 → 单次覆盖」的参数层级用默认值兜底，
     * 链路完整可用。字段先在 DTO 里留好，待 P1 运营/调参页需要时直接接上，无需改契约。
     * 后续静态审查请勿据此判定「前端字段丢失」。
     */
    private Double threshold;

    /**
     * 是否流式返回（F-01）。
     *
     * <p>{@code true} 时 BFF 走 SSE 分支，1:1 转发平台的 {@code delta|done|error} 事件；
     * 缺省/false 保持 P0 的一次性 JSON 返回。<b>刻意不默认 true</b>——
     * 通用 RAG 面板等既有调用方并不解析 SSE，默认改流式等于单方面废掉它们。
     * 由知识库问答页显式传 {@code stream: true} 开启。
     */
    private Boolean stream;

    public String getCapability() {
        return capability;
    }

    public void setCapability(String capability) {
        this.capability = capability;
    }

    public String getQuestion() {
        return question;
    }

    public void setQuestion(String question) {
        this.question = question;
    }

    public String getKb() {
        return kb;
    }

    public void setKb(String kb) {
        this.kb = kb;
    }

    public Map<String, Object> getContext() {
        return context;
    }

    public void setContext(Map<String, Object> context) {
        this.context = context;
    }

    public Integer getTopK() {
        return topK;
    }

    public void setTopK(Integer topK) {
        this.topK = topK;
    }

    public List<Long> getLibraryIds() {
        return libraryIds;
    }

    public void setLibraryIds(List<Long> libraryIds) {
        this.libraryIds = libraryIds == null ? List.of() : libraryIds;
    }

    public Long getSessionId() {
        return sessionId;
    }

    public void setSessionId(Long sessionId) {
        this.sessionId = sessionId;
    }

    public Double getThreshold() {
        return threshold;
    }

    public void setThreshold(Double threshold) {
        this.threshold = threshold;
    }

    public Boolean getStream() {
        return stream;
    }

    public void setStream(Boolean stream) {
        this.stream = stream;
    }
}
